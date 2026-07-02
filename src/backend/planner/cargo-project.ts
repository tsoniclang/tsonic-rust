import type { TargetDiagnostic, TargetRuntimeReference, TargetSelection } from "@tsonic/target-api";
import {
  readRustCrateName,
  readRustEdition,
  readRustOutputType,
} from "../../options/rust-target-options.js";
import type { RustEdition, RustOutputType } from "../../options/rust-target-options.js";
import { missingRuntimeReferenceDiagnostic } from "./diagnostics.js";

export const cargoPathReferenceKind = "cargo-path";
export const cargoCrateAttributeName = "crate";

export interface CargoDependency {
  readonly name: string;
  readonly path: string;
}

export interface CargoManifestPlan {
  readonly packageName: string;
  readonly edition: RustEdition;
  readonly outputType: RustOutputType;
  readonly dependencies: readonly CargoDependency[];
}

export interface CargoManifestPlanResult {
  readonly manifest?: CargoManifestPlan;
  readonly diagnostics: readonly TargetDiagnostic[];
}

export function planCargoManifest(
  target: TargetSelection,
  runtimeReferences: readonly TargetRuntimeReference[],
): CargoManifestPlanResult {
  const diagnostics: TargetDiagnostic[] = [];
  const dependenciesByName = new Map<string, CargoDependency>();
  for (const reference of runtimeReferences) {
    if (reference.kind !== cargoPathReferenceKind) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    const crateName = reference.attributes?.[cargoCrateAttributeName];
    if (crateName === undefined || crateName.length === 0) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    const existing = dependenciesByName.get(crateName);
    if (existing !== undefined && existing.path !== reference.include) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    dependenciesByName.set(crateName, { name: crateName, path: reference.include });
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }
  return {
    manifest: {
      packageName: readRustCrateName(target),
      edition: readRustEdition(target),
      outputType: readRustOutputType(target),
      dependencies: [...dependenciesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "en")),
    },
    diagnostics: [],
  };
}
