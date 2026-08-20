import type { RustSourceFileModel } from "../target-ast/nodes.js";
import type { CargoManifestPlan } from "./project/cargo.js";

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

export interface RustOutputPlan {
  readonly artifacts: readonly RustPlannedArtifact[];
}
