import type { TargetTypeRef, RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { RustObjectRepresentation } from "../../../../analysis/project-types/object-representation.js";
import { rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import {
  rustSourceTypeCarrierValue,
  rustTargetGenericReferences,
} from "../../../../target-model/types/index.js";
import type {
  RustExpr,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustType,
  RustTypeBound,
} from "../../../target-ast/nodes.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { sourceModuleItemPath } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";
import { rustDeclarationAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustTypeParameterBounds } from "../../types/generic-bounds.js";
import { rustOptionalStorageParameters, rustOptionalStorageTypeArguments } from "../../types/type-projections.js";
import { rustTypeParameterFromSourceContract } from "../../../../target-model/names/type-parameters.js";

export interface RustProjectGenericPlan {
  readonly bindings: readonly { readonly parameter: RustGenericParameter; readonly argument: RustTargetGenericArgument }[];
  readonly wherePredicates: RustGenerics["wherePredicates"];
}

export function rustProjectDispatchTraitName(
  definition: RustProjectTypeDefinition,
): string {
  return definition.dispatchName;
}

export function rustProjectRootName(
  definition: RustProjectTypeDefinition,
): string {
  if (definition.rootName === undefined) {
    throw new Error("Rust project root names exist only for project classes.");
  }
  return definition.rootName;
}

export function rustProjectGenerics(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
  parameterIndexes: readonly number[] = definition.genericParameters.map((_, index) => index),
): RustGenerics {
  return rustProjectGenericSyntax(planRustProjectGenerics(definition, [], context, parameterIndexes));
}

export function rustProjectRepresentationGenerics(
  representation: RustObjectRepresentation,
  context: RustPlanContext,
): RustGenerics {
  return rustProjectGenericSyntax(planRustProjectRepresentationGenerics(representation, context));
}

export function planRustProjectRepresentationGenerics(
  representation: RustObjectRepresentation,
  context: RustPlanContext,
): RustProjectGenericPlan {
  return planRustProjectGenerics(
    representation.definition,
    representation.dispatchObjectLifetime === undefined
      ? []
      : [representation.dispatchObjectLifetime],
    context,
  );
}

export function planRustProjectGenerics(
  definition: RustProjectTypeDefinition,
  requiredTypeOutlives: readonly RustLifetimeRef[],
  context: RustPlanContext,
  parameterIndexes: readonly number[] = definition.genericParameters.map((_, index) => index),
): RustProjectGenericPlan {
  const contract = context.input.program.declarationGenericRequirements.contractFor(definition.declaration);
  if (contract === undefined) throw new Error("A source class has no sealed generic requirement contract.");
  const boundsFor = (parameter: Extract<RustProjectTypeDefinition["genericParameters"][number], { readonly kind: "type" }>): readonly RustTypeBound[] => {
    const selected = contract.typeParameters.find(candidate => candidate.identity === parameter.identity);
    if (selected === undefined) throw new Error("A source class generic parameter lost its selected requirements.");
    return rustTypeParameterBounds(parameter, selected.requirements, requiredTypeOutlives);
  };
  const selectedParameters = parameterIndexes.map(index => {
    const parameter = definition.genericParameters[index];
    if (parameter === undefined) throw new Error("A selected native generic parameter is outside its declaration.");
    return parameter;
  });
  const typeIdentities = new Set(selectedParameters.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : []));
  const lifetimeNames = new Set(selectedParameters.flatMap(parameter => parameter.kind === "lifetime" ? [parameter.lifetime.name] : []));
  const inScope = (carrier: TargetTypeRef): boolean => {
    const references = rustTargetGenericReferences(carrier);
    return references.typeIdentities.every(name => typeIdentities.has(name)) &&
      references.lifetimes.every(lifetime => lifetime.kind === "bound" || lifetimeNames.has(lifetime.name));
  };
  const bindings = selectedParameters.map((parameter): RustProjectGenericPlan["bindings"][number] =>
    parameter.kind === "lifetime"
      ? { argument: { kind: "lifetime", lifetime: parameter.lifetime }, parameter: {
          kind: "lifetime",
          name: parameter.lifetime.name,
          outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
        } }
      : { argument: { kind: "type", type: rustTypeParameterFromSourceContract(parameter) }, parameter: {
          kind: "type",
          name: context.typeParameterNames?.get(parameter.identity) ?? parameter.targetName,
          bounds: boundsFor(parameter),
        } });
  const optionalStorage = contract.optionalStorage.filter(entry => !entry.captured && inScope(entry.carrier));
  const storageParameters = rustOptionalStorageParameters(optionalStorage, context);
  bindings.push(...optionalStorage.map((entry, index) => ({
    argument: { kind: "type" as const, type: entry.carrier }, parameter: storageParameters[index]!,
  })));
  return { bindings, wherePredicates: rustDeclarationAssociatedPredicates(definition.declaration, context, inScope) };
}

function rustProjectGenericSyntax(plan: RustProjectGenericPlan): RustGenerics {
  return rustGenericsWithAssociatedBounds(plan.bindings.map(binding => binding.parameter), plan.wherePredicates);
}

export function rustProjectDispatchObjectType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  const definition = context.input.program.projectTypes.definitionForCarrier(carrier);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  const dispatch = rustProjectDispatchTraitType(carrier, context);
  return representation?.kind !== "open-hierarchy" ||
      representation.dispatchObjectLifetime === undefined || dispatch === undefined
    ? undefined
    : {
        kind: "trait-object",
        principal: { trait: dispatch },
        autoTraits: [],
        lifetime: rustLifetimeToAst(representation.dispatchObjectLifetime),
      };
}

export function rustProjectDispatchTraitType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustProjectGeneratedType(carrier, context, rustProjectDispatchTraitName);
}

export function rustProjectRootType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustProjectGeneratedType(carrier, context, rustProjectRootName);
}

export function rustProjectStateType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustProjectGeneratedType(carrier, context, (definition) => definition.stateName);
}

export function rustProjectStateMarker(
  definition: RustProjectTypeDefinition,
  context: RustPlanContext,
  parameterIndexes: readonly number[] = definition.genericParameters.map((_, index) => index),
): {
  readonly name: string;
  readonly type: RustType;
  readonly value: RustExpr;
} | undefined {
  if (parameterIndexes.length === 0) {
    return undefined;
  }
  return {
    name: context.input.program.projectTypes.stateMarkerFieldName(definition),
    type: {
      kind: "named",
      path: "core::marker::PhantomData",
      genericArguments: [{
        kind: "type",
        type: {
          kind: "tuple",
          elements: parameterIndexes.map((index): RustType => {
            const parameter = definition.genericParameters[index];
            if (parameter === undefined) throw new Error("A native state marker has an invalid generic parameter index.");
            return parameter.kind === "lifetime"
              ? {
                  kind: "reference",
                  referent: { kind: "unit" },
                  mutable: false,
                  lifetime: rustLifetimeToAst(parameter.lifetime),
                }
              : { kind: "named", path: context.typeParameterNames?.get(parameter.identity) ?? parameter.targetName };
          }),
        },
      }],
    },
    value: { kind: "path", path: "core::marker::PhantomData" },
  };
}

function rustProjectGeneratedType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
  generatedName: (definition: RustProjectTypeDefinition) => string,
): RustType | undefined {
  const value = rustSourceTypeCarrierValue(carrier);
  const definition = context.input.program.projectTypes.definitionForCarrier(carrier);
  const path = value === undefined || definition === undefined
    ? undefined
    : sourceModuleItemPath(context, value.fileName, generatedName(definition));
  const sourceArguments = value?.genericArguments ?? [];
  if (value === undefined || definition === undefined || path === undefined ||
    sourceArguments.length !== definition.genericParameters.length ||
    definition.genericParameters.some((parameter, index) =>
      sourceArguments[index]?.kind !== parameter.kind)) {
    return undefined;
  }
  const genericArguments: RustGenericArgument[] = [];
  for (const argument of sourceArguments) {
    if (argument.kind === "lifetime") {
      genericArguments.push({
        kind: "lifetime",
        lifetime: rustLifetimeToAst(argument.lifetime),
      });
      continue;
    }
    if (argument.kind !== "type") return undefined;
    const type = rustTypeFromCarrierInContext(argument.type, context);
    if (type === undefined) return undefined;
    genericArguments.push({ kind: "type", type });
  }
  genericArguments.push(...rustOptionalStorageTypeArguments(carrier, context));
  return {
    kind: "named",
    path,
    ...(genericArguments.length === 0
      ? {}
      : { genericArguments: Object.freeze(genericArguments) }),
  };
}
