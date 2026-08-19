import type { TargetCompileResult } from "@tsonic/target-api/artifacts";
import type { RustArtifactPlanResult } from "../artifacts/model.js";
import { printCargoManifest } from "../../print/cargo/manifest.js";
import { printRustSourceFile } from "../../print/rust/index.js";

export function materializeRustArtifacts(
  plan: RustArtifactPlanResult,
): TargetCompileResult {
  if (plan.diagnostics.length > 0) {
    return { artifacts: [], diagnostics: plan.diagnostics };
  }
  return {
    artifacts: plan.artifacts.map((artifact) => artifact.kind === "project"
      ? {
          kind: "project" as const,
          path: artifact.path,
          text: printCargoManifest(artifact.manifest),
        }
      : {
          kind: "source" as const,
          path: artifact.path,
          language: "rust",
          text: printRustSourceFile(artifact.model),
        }),
    diagnostics: [],
  };
}
