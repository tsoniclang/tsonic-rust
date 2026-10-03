import type { TargetTypeRef } from "../model.js";

export const rustSourceErrorTargetId = "rust.program.SourceError";
export const rustWritableSourceErrorTargetId = "rust.program.WritableSourceError";
export const rustMutableJsErrorTargetId = "rust.runtime.MutableJsError";

export function rustSourceErrorTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "target-named", id: rustSourceErrorTargetId });
}

export function isRustSourceErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" &&
    (carrier.id === rustSourceErrorTargetId || carrier.id === rustWritableSourceErrorTargetId);
}

export function rustWritableSourceErrorTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "target-named", id: rustWritableSourceErrorTargetId });
}

export function isRustWritableSourceErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustWritableSourceErrorTargetId;
}

export function rustMutableJsErrorTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "target-named", id: rustMutableJsErrorTargetId });
}

export function isRustMutableJsErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustMutableJsErrorTargetId;
}
