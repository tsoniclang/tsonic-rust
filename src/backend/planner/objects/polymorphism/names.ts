import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import type { RustObjectRepresentation } from "../../../../analysis/project-types/object-representation.js";
import {
  rustSourceTypeCarrierValue,
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
): RustGenerics {
  return rustProjectGenericsWithTypeOutlives(definition, [], context);
}

export function rustProjectRepresentationGenerics(
  representation: RustObjectRepresentation,
  context: RustPlanContext,
): RustGenerics {
  return rustProjectGenericsWithTypeOutlives(
    representation.definition,
    representation.dispatchObjectLifetime === undefined
      ? []
      : [representation.dispatchObjectLifetime],
    context,
  );
}

function rustProjectGenericsWithTypeOutlives(
  definition: RustProjectTypeDefinition,
  requiredTypeOutlives: readonly RustLifetimeRef[],
  context: RustPlanContext,
): RustGenerics {
  const contract = context.input.program.declarationGenericRequirements.contractFor(definition.declaration);
  if (contract === undefined) throw new Error("A source class has no sealed generic requirement contract.");
  const boundsFor = (parameter: Extract<RustProjectTypeDefinition["genericParameters"][number], { readonly kind: "type" }>): readonly RustTypeBound[] => {
    const selected = contract.typeParameters.find(candidate => candidate.name === parameter.targetName);
    if (selected === undefined) throw new Error("A source class generic parameter lost its selected requirements.");
    return rustTypeParameterBounds(parameter, selected.requirements, requiredTypeOutlives);
  };
  const parameters = definition.genericParameters.map((parameter): RustGenericParameter =>
    parameter.kind === "lifetime"
      ? {
          kind: "lifetime",
          name: parameter.lifetime.name,
          outlives: Object.freeze(parameter.outlives.map(rustLifetimeToAst)),
        }
      : {
          kind: "type",
          name: parameter.targetName,
          bounds: boundsFor(parameter),
        });
  return Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: rustDeclarationAssociatedPredicates(definition.declaration, context),
  });
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
): {
  readonly name: string;
  readonly type: RustType;
  readonly value: RustExpr;
} | undefined {
  if (definition.genericParameters.length === 0) {
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
          elements: definition.genericParameters.map((parameter): RustType =>
            parameter.kind === "lifetime"
              ? {
                  kind: "reference",
                  referent: { kind: "unit" },
                  mutable: false,
                  lifetime: rustLifetimeToAst(parameter.lifetime),
                }
              : { kind: "named", path: parameter.targetName }),
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
  return {
    kind: "named",
    path,
    ...(genericArguments.length === 0
      ? {}
      : { genericArguments: Object.freeze(genericArguments) }),
  };
}
