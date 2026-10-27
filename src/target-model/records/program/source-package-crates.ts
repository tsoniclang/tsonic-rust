import type { CargoManifestPlan } from "../../project/cargo.js";

export interface RustSourcePackageCargoPlan {
  readonly rootManifest: CargoManifestPlan;
  readonly externalManifestsByComponentId: ReadonlyMap<string,
    { readonly directory: `crates/${string}`; readonly manifest: CargoManifestPlan }>;
}

export type RustPackageCargoEmission =
  | { readonly kind: "user-owned"; readonly manifestPath: string }
  | { readonly kind: "generated"; readonly plan: RustSourcePackageCargoPlan };

export interface RustPackageCargoRecords {
  readonly packageCargo: { readonly get: () => RustPackageCargoEmission | undefined };
}
