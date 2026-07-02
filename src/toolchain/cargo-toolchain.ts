import type { TargetToolchain, TargetToolchainContext, TargetToolchainInput, TargetToolchainResult } from "@tsonic/target-api";

// Source-to-source parity with the reference dotnet toolchain: report the
// produced artifacts deterministically. Cargo invocation (fmt/check/test/clippy)
// arrives when generated projects are expected to build.
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
