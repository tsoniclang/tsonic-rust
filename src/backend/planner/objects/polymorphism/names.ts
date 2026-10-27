import type { TargetTypeRef, RustTargetGenericArgument } from "../../../../target-model/types/model.js";
import type { RustTypeRenderingContext } from "../../types/render.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { RustObjectRepresentation } from "../../../../target-model/records/objects/object-representation.js";
import { rustGenericsWithAssociatedBounds, rustTypeParameterBounds } from "../../types/generic-bounds.js";
import {
  rustSourceTypeCarrierValue,
} from "../../../../target-model/types/index.js";
import type { RustExpr, RustGenericArgument, RustGenericParameter, RustGenerics, RustType } from "../../../target-ast/syntax/nodes.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { sourceModuleItemPath } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { rustProjectProjectionPredicates } from "../../types/project-projection-bounds.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustOptionalStorageParameters, rustOptionalStorageTypeArguments } from "../../types/type-projections.js";
import { rustTypeParameterFromSourceContract } from "../../../../target-model/types/carriers/generic-references.js";

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
    failRustPlannerInvariant("Rust project root names exist only for project classes.", definition.declaration);
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
  const selected = context.input.program.records.projectGenerics.get(definition, parameterIndexes, requiredTypeOutlives, context.promiseBody);
  if (selected === undefined) failRustPlannerInvariant("An admitted source class requires its sealed native generic context.", definition.declaration);
  const bindings = selected.parameters.map(({ parameter, requirements }): RustProjectGenericPlan["bindings"][number] =>
    parameter.kind === "lifetime"
      ? { argument: { kind: "lifetime", lifetime: parameter.lifetime }, parameter: {
          kind: "lifetime", name: parameter.lifetime.name, outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
        } }
      : { argument: { kind: "type", type: rustTypeParameterFromSourceContract(parameter) }, parameter: {
          kind: "type", name: context.typeParameterNames?.get(parameter.identity) ?? parameter.targetName,
          bounds: rustTypeParameterBounds(parameter, requirements, selected.outlives),
        } });
  const storage = rustOptionalStorageParameters(selected.optionalStorage, context);
  bindings.push(...selected.optionalStorage.map((entry, index) => ({
    argument: { kind: "type" as const, type: entry.carrier }, parameter: storage[index]!,
  })));
  return { bindings, wherePredicates: [...rustAssociatedPredicates(selected.associated, context),
    ...rustProjectProjectionPredicates(selected.projections, context)] };
}

function rustProjectGenericSyntax(plan: RustProjectGenericPlan): RustGenerics {
  return rustGenericsWithAssociatedBounds(plan.bindings.map(binding => binding.parameter), plan.wherePredicates);
}

export function rustProjectDispatchObjectType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  const definition = context.input.program.records.projectType.get(carrier);
  const representation = context.input.program.records.objectRepresentation.get(definition);
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
  context: RustTypeRenderingContext,
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
  const parameters = planRustProjectGenerics(definition, [], context, parameterIndexes).bindings.map(binding => binding.parameter);
  if (parameters.length === 0) {
    return undefined;
  }
  return {
    name: requiredProjectMarkerName(definition, parameterIndexes, context),
    type: {
      kind: "named",
      path: "core::marker::PhantomData",
      genericArguments: [{
        kind: "type",
        type: {
          kind: "tuple",
          elements: parameters.map((parameter): RustType => {
            return parameter.kind === "lifetime"
              ? {
                  kind: "reference",
                  referent: { kind: "unit" },
                  mutable: false,
                  lifetime: { kind: "named", name: parameter.name },
                }
              : { kind: "named", path: parameter.name };
          }),
        },
      }],
    },
    value: { kind: "path", path: "core::marker::PhantomData" },
  };
}

function rustProjectGeneratedType(
  carrier: TargetTypeRef,
  context: RustTypeRenderingContext,
  generatedName: (definition: RustProjectTypeDefinition) => string,
): RustType | undefined {
  const value = rustSourceTypeCarrierValue(carrier);
  const definition = context.input.program.records.projectType.get(carrier);
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

function requiredProjectMarkerName(definition: RustProjectTypeDefinition, indexes: readonly number[], context: RustPlanContext): string {
  const selected = context.input.program.records.projectGenerics.get(definition, indexes, [], context.promiseBody);
  if (selected === undefined) failRustPlannerInvariant("An admitted native state marker requires its sealed generic context.", definition.declaration);
  return selected.markerName;
}
