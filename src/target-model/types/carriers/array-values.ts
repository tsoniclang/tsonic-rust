import type { TargetTypeRef } from "../model.js";

export const rustJsArrayValueTargetId = "rust.js.JsArrayValue";

export function rustJsArrayValueTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayValueTargetId };
}

export function isRustJsArrayValueCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustJsArrayValueTargetId &&
    (carrier.genericArguments?.length ?? 0) === 0;
}
