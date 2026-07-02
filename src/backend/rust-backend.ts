import type { TargetBackend, TargetBackendContext, TargetCompileInput, TargetCompileResult } from "@tsonic/target-api";
import { planRustArtifacts } from "./planner/rust-planner.js";

export function createRustBackend(_context: TargetBackendContext): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      return planRustArtifacts(input);
    },
  };
}
