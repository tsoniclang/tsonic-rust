import type { RustSourceFileModel } from "../target-ast/nodes.js";
import type { CargoManifestPlan } from "./project/cargo.js";
import type { RustEdition } from "../../target-model/project/model.js";

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
  readonly edition: RustEdition;
  readonly artifacts: readonly RustPlannedArtifact[];
}
