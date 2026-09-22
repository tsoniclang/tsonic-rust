import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/nodes.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { rustTargetGenericArgumentToAstInContext } from "../types/render.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/index.js";
import { sourceModuleItemPath } from "../program/plan-context.js";

export function rustClassEnvironmentType(carrier: TargetTypeRef, context: RustTypeRenderingContext): RustType | undefined {
  const environment = context.input.program.classValues.forCarrier(carrier)?.environment;
  const selected = rustSourceTypeCarrierValue(carrier);
  if (environment === undefined || selected === undefined) return undefined;
  const path = sourceModuleItemPath(context, selected.fileName, environment.typeName);
  const arguments_ = environment.genericParameterIndexes.map(index => {
    const argument = selected.genericArguments[index];
    return argument === undefined ? undefined : rustTargetGenericArgumentToAstInContext(argument, context);
  });
  if (path === undefined || arguments_.some(argument => argument === undefined)) return undefined;
  return { kind: "named", path, genericArguments: arguments_ as NonNullable<typeof arguments_[number]>[] };
}

export function rustClassEnvironmentHandleType(carrier: TargetTypeRef, context: RustTypeRenderingContext): RustType | undefined {
  const type = rustClassEnvironmentType(carrier, context);
  const environment = context.input.program.classValues.forCarrier(carrier)?.environment;
  if (environment?.storage === "value") return type;
  return type === undefined ? undefined : { kind: "named", path: "alloc::rc::Rc", genericArguments: [{ kind: "type", type }] };
}
