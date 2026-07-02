import type { TargetToolchain, TargetToolchainContext, TargetToolchainInput, TargetToolchainResult } from "@tsonic/target-api";

// Source-to-source stage: the toolchain reports produced artifacts
// deterministically; generated projects are validated by the cargo proof
// tests.
export function createCargoToolchain(_context: TargetToolchainContext): TargetToolchain {
  return {
    prepare(input: TargetToolchainInput): TargetToolchainResult {
      return {
        diagnostics: [],
        producedArtifacts: input.compileResult.artifacts.map((artifact) => artifact.path),
      };
    },
  };
}
