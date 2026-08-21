import type { RustEdition, RustOutputType } from "../../../target-model/project/model.js";
import type { cargoCratesIoRegistry } from "../../../target-model/project/model.js";

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
  readonly workspace?: {
    readonly members: readonly string[];
  };
}
