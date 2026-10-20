import type { TargetRuntimeReference } from "@tsonic/target-api/artifacts";

export type MaterializedCargoCrate =
  | { readonly path: string }
  | { readonly reason: string; readonly details: readonly string[] };

export type RustRuntimeCrateAcquisitions = ReadonlyMap<TargetRuntimeReference, MaterializedCargoCrate>;
