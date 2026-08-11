import type { TargetBackend, TargetBackendContext, TargetCompileInput, TargetCompileResult } from "@tsonic/target-api";
import { planRustArtifacts } from "./planner/rust-planner.js";
import { createRustTranslationContext } from "../translate/context.js";

export function createRustBackend(context: TargetBackendContext): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      return planRustArtifacts(createRustTranslationContext(context, input));
    },
  };
}
