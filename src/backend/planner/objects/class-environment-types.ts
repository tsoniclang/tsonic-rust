import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { rustTargetGenericArgumentToAstInContext } from "../types/render.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/index.js";
import { sourceModuleItemPath } from "../program/plan-context.js";
import { rustOptionalStorageTypeArguments } from "../types/type-projections.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustClassEnvironmentType(
  carrier: TargetTypeRef, context: RustTypeRenderingContext,
  position: "general" | "parameter" | "return" = "general",
): RustType | undefined {
  const environment = context.input.program.records.classEnvironmentType.get(carrier)?.environment;
  const selected = rustSourceTypeCarrierValue(carrier);
  if (environment === undefined || selected === undefined) return undefined;
  const path = sourceModuleItemPath(context, selected.fileName, environment.typeName);
  const arguments_ = environment.genericParameterIndexes.map(index => {
    const argument = selected.genericArguments[index];
    return argument === undefined ? undefined : rustTargetGenericArgumentToAstInContext(argument, context, position);
  });
  if (path === undefined || arguments_.some(argument => argument === undefined))
    failRustPlannerInvariant("An admitted class environment requires its exact native path and generic arguments.", environment.declaration);
  return { kind: "named", path, genericArguments: [...arguments_ as NonNullable<typeof arguments_[number]>[],
    ...rustOptionalStorageTypeArguments(carrier, context, environment.genericParameterIndexes, position)] };
}

export function rustClassEnvironmentHandleType(
  carrier: TargetTypeRef, context: RustTypeRenderingContext,
  position: "general" | "parameter" | "return" = "general",
): RustType | undefined {
  const type = rustClassEnvironmentType(carrier, context, position);
  const environment = context.input.program.records.classEnvironmentType.get(carrier)?.environment;
  if (environment?.storage === "value") return type;
  return type === undefined ? undefined : { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type }] };
}
