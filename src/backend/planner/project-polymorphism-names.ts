import type { TargetTypeRef } from "../../policy/types.js";
import type { RustProjectTypeDefinition } from "../../source/rust-target-semantics/project-type-policy.js";
import { rustSourceTypeCarrierValue } from "../../source/rust-target-types.js";
import type { RustType, RustTypeParameter } from "../rust-ast/nodes.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";

export const rustProjectInitializeMethod = "__tsonic_initialize";

export function rustProjectDispatchTraitName(
  definition: RustProjectTypeDefinition,
): string {
  return `__TsonicDispatch_${definition.sourceName}`;
}

export function rustProjectRootName(
  definition: RustProjectTypeDefinition,
): string {
  return `__TsonicRoot_${definition.sourceName}`;
}

export function rustProjectTypeParameters(
  definition: RustProjectTypeDefinition,
): readonly RustTypeParameter[] {
  return definition.typeParameterNames.map((name) => ({
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

function rustProjectGeneratedType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
  generatedName: (definition: RustProjectTypeDefinition) => string,
): RustType | undefined {
  const value = rustSourceTypeCarrierValue(carrier);
  const definition = context.input.projectTypes.definitionForCarrier(carrier);
  const moduleName = value === undefined
    ? undefined
    : context.moduleNameByFileName.get(value.fileName);
  if (value === undefined || definition === undefined || moduleName === undefined ||
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
    path: moduleName === context.moduleName
      ? generatedName(definition)
      : `crate::${moduleName}::${generatedName(definition)}`,
    ...(typeArguments.length === 0
      ? {}
      : { typeArguments: typeArguments as readonly RustType[] }),
  };
}
