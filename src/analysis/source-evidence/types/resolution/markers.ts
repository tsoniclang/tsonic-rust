import { sourceMarkerFactKey } from "@tsonic/tsts";
import type { ExtensionFactSubject, Type } from "@tsonic/tsts";
import { asNode } from "../../../../policy/identities/selected-source.js";
import type { RustTargetTypeResolutionContext } from "./model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustJsStringTargetType } from "../../../../target-model/types/carriers/js.js";

export function resolveRustJsStringCarrier(
  subject: ExtensionFactSubject,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  return resolveRustSourceMarker(subject, context) === "js-string"
    ? rustJsStringTargetType()
    : undefined;
}

export function resolveRustSourceMarker(
  subject: ExtensionFactSubject,
  context: RustTargetTypeResolutionContext,
): string | undefined {
  const node = asNode(subject, context);
  const subjects = node === undefined
    ? [subject, ...context.currentSemantics.facts.typeSubjects(subject as Type)]
    : [node];
  const markers = new Set<string>();
  for (const candidate of subjects) {
    const marker = context.source.sourceFacts.getFact(candidate, sourceMarkerFactKey);
    if (marker !== undefined) markers.add(marker.marker);
  }
  return markers.size === 1 ? markers.values().next().value : undefined;
}
