import type { TargetTypeRef } from "../../../../policy/types/model.js";
import type { RustProjectTypeDefinition } from "../../../../analysis/project-types/type-policy.js";
import { rustSourceTypeCarrierValue } from "../../../../policy/types/target-types.js";
import type { RustExpr, RustType, RustTypeParameter } from "../../../rust-ast/nodes.js";
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

export function rustProjectTypeParameters(
  definition: RustProjectTypeDefinition,
): readonly RustTypeParameter[] {
  return definition.targetTypeParameterNames.map((name) => ({
    name,
    bounds: [
      { kind: "trait", path: "Clone" },
      { kind: "lifetime", name: "static" },
    ],
  }));
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
  if (definition.targetTypeParameterNames.length === 0) {
    return undefined;
  }
  return {
    name: context.input.projectTypes.stateMarkerFieldName(definition),
    type: {
      kind: "named",
      path: "std::marker::PhantomData",
      typeArguments: [{
        kind: "tuple",
        elements: definition.targetTypeParameterNames.map((name) => ({
          kind: "named",
          path: name,
        })),
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
  const definition = context.input.projectTypes.definitionForCarrier(carrier);
  const path = value === undefined || definition === undefined
    ? undefined
    : sourceModuleItemPath(context, value.fileName, generatedName(definition));
  if (value === undefined || definition === undefined || path === undefined ||
    value.typeArguments.length !== definition.typeParameterNames.length) {
    return undefined;
  }
  const typeArguments = value.typeArguments.map((argument) =>
    rustTypeFromCarrierInContext(argument, context));
  if (typeArguments.some((argument) => argument === undefined)) {
    return undefined;
  }
  return {
    kind: "named",
    path,
    ...(typeArguments.length === 0
      ? {}
      : { typeArguments: typeArguments as readonly RustType[] }),
  };
}
