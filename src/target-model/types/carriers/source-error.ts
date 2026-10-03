import type { TargetTypeRef } from "../model.js";

export const rustSourceErrorTargetId = "rust.program.SourceError";

export function rustSourceErrorTargetType(): TargetTypeRef {
  return Object.freeze({ kind: "target-named", id: rustSourceErrorTargetId });
}

export function isRustSourceErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustSourceErrorTargetId;
}
