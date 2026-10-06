import type { SourceStorageProjection } from "@tsonic/target-api/analysis";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function rustSourceStorageComponentContext(
  context: RustTargetTypeResolutionContext,
  component: SourceStorageProjection,
): RustTargetTypeResolutionContext {
  const subject = context.sourceStorageSubject;
  const selection = subject === undefined ? undefined : context.sourceStorage.subject(
    subject.node, subject.kind, [...subject.projection, component]);
  return { ...context, sourceStorageSubject: selection?.kind === "resolved" ? selection.subject : undefined };
}
