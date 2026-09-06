import { rawPointerFactKey, rawPointerOperationFactKey, sourceMarkerFactKey } from "@tsonic/tsts";
import type { ExtensionFactSubject, Node, RawPointerOperationFact, ReadonlySourceFactResolver } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext } from "../types/resolution/model.js";

export function isRustSourceRawPointer(
  subject: ExtensionFactSubject,
  context: RustTargetTypeResolutionContext,
): boolean {
  const fact = context.facts.get(subject, rawPointerFactKey);
  const marker = context.facts.get(subject, sourceMarkerFactKey);
  return marker?.kind === "type-marker" ? marker.marker === "raw-pointer"
    : fact?.representation === "opaque-identity";
}

export function readRustSourceRawPointerIdentity(
  call: Node,
  facts: ReadonlySourceFactResolver,
): Exclude<RawPointerOperationFact, { readonly operation: "bind-raw-pointer" }> | undefined {
  const fact = facts.getFact(call, rawPointerOperationFactKey);
  return fact === undefined || fact.operation === "bind-raw-pointer" ? undefined : fact;
}
