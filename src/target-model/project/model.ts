export type RustOutputType = "lib" | "bin";
export type RustEdition = "2021" | "2024";

export const cargoCratesIoRegistry = "crates-io";

export interface RustCargoDependency {
  readonly name: string;
  readonly path: string;
  readonly registryPatch?: typeof cargoCratesIoRegistry;
}
