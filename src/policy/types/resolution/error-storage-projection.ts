import type { SourceErrorStorageProjection } from "@tsonic/target-api/analysis";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function rustSourceErrorComponentContext(
  context: RustTargetTypeResolutionContext,
  component: SourceErrorStorageProjection,
): RustTargetTypeResolutionContext {
  return { ...context, sourceErrorProjection: [...context.sourceErrorProjection ?? [], component] };
}
