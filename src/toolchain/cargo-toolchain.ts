import type { TargetToolchain, TargetToolchainContext, TargetToolchainInput, TargetToolchainResult } from "@tsonic/target-api";

// Source-to-source stage: report the produced artifacts deterministically.
// Direct cargo invocation from the toolchain arrives with host integration;
// generated projects are already validated by the cargo proof tests.
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
