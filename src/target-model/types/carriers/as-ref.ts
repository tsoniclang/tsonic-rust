import type { TargetTypeRef } from "../model.js";
import { rustNamedTypeCarrierValue } from "./native.js";
import { rustStringTargetId, rustStrTargetId } from "./source-types.js";

const stringReferencePaths: ReadonlySet<string> = new Set([
  "std::path::Path",
  "std::ffi::OsStr",
]);

export function rustCarrierSupportsAsRef(
  source: TargetTypeRef,
  target: TargetTypeRef,
): boolean {
  if (source.kind === "reference") {
    return rustCarrierSupportsAsRef(source.referent, target);
  }
  if (source.kind !== "target-named" ||
    (source.id !== rustStringTargetId && source.id !== rustStrTargetId) ||
    (source.genericArguments?.length ?? 0) !== 0) {
    return false;
  }
  if (target.kind === "target-named" && target.id === rustStrTargetId &&
    (target.genericArguments?.length ?? 0) === 0) {
    return true;
  }
  if (target.kind === "slice") {
    return target.element.kind === "source-primitive" && target.element.name === "uint8";
  }
  const named = rustNamedTypeCarrierValue(target);
  return named !== undefined && named.genericArguments.length === 0 &&
    stringReferencePaths.has(named.path);
}
