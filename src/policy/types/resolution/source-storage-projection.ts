import type { SourceStorageProjection } from "@tsonic/target-api/analysis";
import type { RustTargetTypeResolutionContext } from "./model.js";

export function rustSourceStorageComponentContext(
  context: RustTargetTypeResolutionContext,
  component: SourceStorageProjection,
): RustTargetTypeResolutionContext {
  return { ...context, sourceStorageProjection: [...context.sourceStorageProjection ?? [], component] };
}
