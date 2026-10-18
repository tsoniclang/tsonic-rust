import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { rustNativeTypeInputContextForRendering, rustTypeFromCarrierInContext } from "../types/render.js";
import { rustNativeClassEnvironmentCarrier } from "../../../policy/types/model/native-type-selection.js";

export function rustClassEnvironmentType(carrier: TargetTypeRef, context: RustTypeRenderingContext): RustType | undefined {
  const selected = rustNativeClassEnvironmentCarrier(carrier, rustNativeTypeInputContextForRendering(context), false);
  return selected === undefined ? undefined : rustTypeFromCarrierInContext(selected, context);
}

export function rustClassEnvironmentHandleType(carrier: TargetTypeRef, context: RustTypeRenderingContext): RustType | undefined {
  const selected = rustNativeClassEnvironmentCarrier(carrier, rustNativeTypeInputContextForRendering(context), true);
  return selected === undefined ? undefined : rustTypeFromCarrierInContext(selected, context);
}
