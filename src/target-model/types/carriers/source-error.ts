import type { TargetTypeRef } from "../model.js";

export const rustSourceErrorTargetId = "rust.program.SourceError";
export const rustWritableSourceErrorTargetId = "rust.program.WritableSourceError";
export const rustMutableJsErrorTargetId = "rust.runtime.MutableJsError";

export function rustSourceErrorTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "target-named", id: rustSourceErrorTargetId });
}

export function isRustSourceErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  const identity = nativeErrorIdentity(carrier);
  return identity === rustSourceErrorTargetId || identity === rustWritableSourceErrorTargetId;
}

export function isRustReadonlySourceErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return nativeErrorIdentity(carrier) === rustSourceErrorTargetId;
}

export function rustWritableSourceErrorTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "target-named", id: rustWritableSourceErrorTargetId });
}

export function isRustWritableSourceErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return nativeErrorIdentity(carrier) === rustWritableSourceErrorTargetId;
}

export function rustMutableJsErrorTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "target-named", id: rustMutableJsErrorTargetId });
}

export function isRustMutableJsErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return nativeErrorIdentity(carrier) === rustMutableJsErrorTargetId;
}

function nativeErrorIdentity(carrier: TargetTypeRef | undefined): string | undefined {
  return carrier?.kind === "target-named" && (carrier.genericArguments?.length ?? 0) === 0 ? carrier.id : undefined;
}
