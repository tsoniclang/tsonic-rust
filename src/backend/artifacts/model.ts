import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustSourceFileModel } from "../rust-ast/nodes.js";
import type { CargoManifestPlan } from "../project-model/cargo.js";

export type RustPlannedArtifact =
  | {
      readonly kind: "project";
      readonly path: "Cargo.toml" | `crates/${string}/Cargo.toml`;
      readonly manifest: CargoManifestPlan;
    }
  | {
      readonly kind: "source";
      readonly path: string;
      readonly model: RustSourceFileModel;
    };

export interface RustArtifactPlanResult {
  readonly artifacts: readonly RustPlannedArtifact[];
  readonly diagnostics: readonly TargetDiagnostic[];
}
