import type { TargetCompileOutput } from "@tsonic/target-api/artifacts";
import type { RustOutputPlan } from "../artifact-model/output.js";
import { printCargoManifest } from "../../print/project/manifest.js";
import { printRustSourceFile } from "../../print/source/index.js";
import { formatRustCompileOutput } from "./rustfmt.js";

export function materializeRustOutputPlan(
  plan: RustOutputPlan,
): TargetCompileOutput {
  const output = Object.freeze({
    artifacts: Object.freeze(plan.artifacts.map((artifact) => Object.freeze(
      artifact.kind === "project"
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
        },
    ))),
  });
  return formatRustCompileOutput(output, plan.edition);
}
