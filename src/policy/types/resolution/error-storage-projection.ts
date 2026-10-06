import type { SourceStorageProjection } from "@tsonic/target-api/analysis";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function rustSourceErrorComponentContext(
  context: RustTargetTypeResolutionContext,
  component: SourceStorageProjection,
): RustTargetTypeResolutionContext {
  return { ...context, sourceErrorProjection: [...context.sourceErrorProjection ?? [], component] };
}
