import type {
  RustCargoDependency,
  RustEdition,
  RustOutputType,
} from "../../../target-model/project/model.js";

export type CargoDependency = RustCargoDependency;

export interface CargoManifestPlan {
  readonly packageName: string;
  readonly edition: RustEdition;
  readonly outputType: RustOutputType;
  readonly dependencies: readonly CargoDependency[];
  readonly workspace?: {
    readonly members: readonly string[];
  };
}
