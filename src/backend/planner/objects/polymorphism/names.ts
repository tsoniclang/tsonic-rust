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
import { rustLifetimesEqual } from "../../../../target-model/lifetimes/index.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";

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
): RustGenerics {
  return rustProjectGenericsWithTypeOutlives(definition, []);
}

export function rustProjectRepresentationGenerics(
  representation: RustObjectRepresentation,
): RustGenerics {
  return rustProjectGenericsWithTypeOutlives(
    representation.definition,
    representation.dispatchObjectLifetime === undefined
      ? []
      : [representation.dispatchObjectLifetime],
  );
}

function rustProjectGenericsWithTypeOutlives(
  definition: RustProjectTypeDefinition,
  requiredTypeOutlives: readonly RustLifetimeRef[],
): RustGenerics {
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
          bounds: projectTypeBounds(parameter, requiredTypeOutlives),
        });
  return Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: Object.freeze([]),
  });
}

function projectTypeBounds(
  parameter: Extract<
    RustProjectTypeDefinition["genericParameters"][number],
    { readonly kind: "type" }
  >,
  requiredOutlives: readonly RustLifetimeRef[],
): readonly RustTypeBound[] {
  const outlives = [
    ...parameter.outlives,
    ...requiredOutlives.filter((required) =>
      !parameter.outlives.some((existing) => rustLifetimesEqual(existing, required))),
  ];
  return Object.freeze([
    { kind: "trait", path: "Clone" },
    ...outlives.map((lifetime): RustTypeBound => ({
      kind: "lifetime",
      lifetime: rustLifetimeToAst(lifetime),
    })),
    ...(parameter.maybeSized ? [{ kind: "maybe-sized" as const }] : []),
  ]);
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
