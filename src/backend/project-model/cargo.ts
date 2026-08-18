import type { RustEdition, RustOutputType } from "../../options/rust-target-options.js";
import type { cargoCratesIoRegistry } from "../../providers/model/cargo-reference.js";

export interface CargoDependency {
  readonly name: string;
  readonly path: string;
  readonly registryPatch?: typeof cargoCratesIoRegistry;
}

export interface CargoManifestPlan {
  readonly packageName: string;
  readonly edition: RustEdition;
  readonly outputType: RustOutputType;
  readonly dependencies: readonly CargoDependency[];
}
