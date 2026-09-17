import { sourceMarkerFactKey } from "@tsonic/tsts";
import type { ExtensionFactSubject, Type } from "@tsonic/tsts";
import { asNode } from "../../evidence/selected-source.js";
import type { RustTargetTypeResolutionContext } from "./model.js";

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
    const marker = context.facts.resolve(candidate, sourceMarkerFactKey) ??
      context.facts.get(candidate, sourceMarkerFactKey);
    if (marker !== undefined) markers.add(marker.marker);
  }
  return markers.size === 1 ? markers.values().next().value : undefined;
}
