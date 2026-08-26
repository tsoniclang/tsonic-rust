import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import { rustSourceTypeCarrierValue } from "../../../../target-model/types/index.js";
import type {
  RustExpr,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustType,
  RustTypeBound,
} from "../../../target-ast/nodes.js";
import { rustLifetimeToAst } from "../../types/render.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { sourceModuleItemPath } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";

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
          bounds: projectTypeBounds(parameter),
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
): readonly RustTypeBound[] {
  return Object.freeze([
    { kind: "trait", path: "Clone" },
    { kind: "lifetime", lifetime: { kind: "static" } },
    ...parameter.outlives.map((lifetime): RustTypeBound => ({
      kind: "lifetime",
      lifetime: rustLifetimeToAst(lifetime),
    })),
    ...(parameter.maybeSized ? [{ kind: "maybe-sized" as const }] : []),
  ]);
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
      path: "std::marker::PhantomData",
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
    value: { kind: "path", path: "std::marker::PhantomData" },
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
  const lifetimeCount = definition?.genericParameters.filter((parameter) =>
    parameter.kind === "lifetime").length ?? 0;
  if (value === undefined || definition === undefined || path === undefined ||
    value.lifetimeArguments.length !== lifetimeCount ||
    value.typeArguments.length !== definition.typeParameterNames.length) {
    return undefined;
  }
  const typeArguments = value.typeArguments.map((argument) =>
    rustTypeFromCarrierInContext(argument, context));
  if (typeArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  const genericArguments: RustGenericArgument[] = [
    ...value.lifetimeArguments.map((lifetime): RustGenericArgument => ({
      kind: "lifetime",
      lifetime: rustLifetimeToAst(lifetime),
    })),
    ...(typeArguments as RustType[]).map((type): RustGenericArgument => ({
      kind: "type",
      type,
    })),
  ];
  return {
    kind: "named",
    path,
    ...(genericArguments.length === 0
      ? {}
      : { genericArguments: Object.freeze(genericArguments) }),
  };
}
