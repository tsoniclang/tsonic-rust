import type { TargetBackend, TargetBackendContext, TargetCompileInput, TargetCompileResult } from "@tsonic/target-api";
import { planRustArtifacts } from "./planner/rust-planner.js";
import { createRustTranslationContext } from "../translate/context.js";
import type { RustProviderSemantics } from "../source/provider-packages/index.js";

export function createRustBackend(
  context: TargetBackendContext,
  compilerProviderSemantics?: RustProviderSemantics,
): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      return planRustArtifacts(createRustTranslationContext(context, input, compilerProviderSemantics));
    },
  };
}
