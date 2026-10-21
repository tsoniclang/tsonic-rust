import type { CargoManifestPlan } from "../../../target-model/project/cargo.js";
import type { RustPlanningContext } from "../context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export type RustCargoProjectPlan =
  | { readonly kind: "generated"; readonly manifest: CargoManifestPlan }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export function planRustCargoProject(
  input: RustPlanningContext,
): RustCargoProjectPlan {
  const selected = input.program.records.packageCargo.get();
  if (selected === undefined) failRustPlannerInvariant("An admitted native project requires its sealed Cargo manifests.");
  return selected.kind === "generated" ? Object.freeze({ kind: "generated", manifest: selected.plan.rootManifest }) : selected;
}
