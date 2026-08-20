import type {
  TargetDiagnostic,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import { materializeCargoCrate } from "../../../providers/model/cargo-package.js";
import type { RustTargetConfiguration } from "../../../target-model/configuration/model.js";
import type { CargoDependency, CargoManifestPlan } from "../../artifact-model/project/cargo.js";
import {
  invalidCargoRuntimeReferenceDiagnostic,
  missingRuntimeReferenceDiagnostic,
} from "../diagnostics.js";
import { isValidRustIdentifier } from "../program/plan-context.js";
import {
  cargoCrateAttributeName,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
} from "../../../providers/model/cargo-reference.js";
import { cargoCratesIoRegistry } from "../../../target-model/project/model.js";

export interface CargoManifestPlanResult {
  readonly manifest?: CargoManifestPlan;
  readonly diagnostics: readonly TargetDiagnostic[];
}

export type RustCargoProjectPlan =
  | { readonly kind: "generated"; readonly manifest: CargoManifestPlan }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export interface RustCargoProjectPlanResult {
  readonly project?: RustCargoProjectPlan;
  readonly diagnostics: readonly TargetDiagnostic[];
}

export function planRustCargoProject(
  configuration: RustTargetConfiguration,
  runtimeReferences: readonly TargetRuntimeReference[],
): RustCargoProjectPlanResult {
  if (configuration.project.kind === "generated") {
    const generated = planCargoManifest(configuration, runtimeReferences);
    return generated.manifest === undefined
      ? { diagnostics: generated.diagnostics }
      : { project: { kind: "generated", manifest: generated.manifest }, diagnostics: [] };
  }
  return {
    project: {
      kind: "user-owned",
      manifestPath: configuration.project.manifestPath,
    },
    diagnostics: [],
  };
}

export function planCargoManifest(
  configuration: RustTargetConfiguration,
  runtimeReferences: readonly TargetRuntimeReference[],
): CargoManifestPlanResult {
  const diagnostics: TargetDiagnostic[] = [];
  const dependenciesByName = new Map<string, CargoDependency>();
  for (let index = 0; index < runtimeReferences.length; index += 1) {
    if (!(index in runtimeReferences)) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        undefined,
        `runtime reference list contains a sparse slot at index ${index}.`,
        [`runtime.reference.index=${index}`],
      ));
      continue;
    }
    const reference = runtimeReferences[index];
    if (reference === undefined || typeof reference !== "object") {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference,
        `runtime reference at index ${index} is not an object.`,
        [`runtime.reference.index=${index}`],
      ));
      continue;
    }
    if (reference.kind !== cargoPathReferenceKind) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    if (typeof reference.include !== "string" || reference.include.length === 0) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        "include must be a non-empty absolute crate directory path.",
      ));
      continue;
    }
    const attributes = reference.attributes;
    if (attributes === undefined || attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        "attributes must be an object containing an explicit crate identity.",
      ));
      continue;
    }
    const unsupportedAttribute = Object.keys(attributes)
      .find((key) => key !== cargoCrateAttributeName && key !== cargoRegistryPatchAttributeName);
    if (unsupportedAttribute !== undefined) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        `attribute '${unsupportedAttribute}' is not part of the Cargo path reference contract.`,
      ));
      continue;
    }
    const crateName = attributes[cargoCrateAttributeName];
    if (typeof crateName !== "string" || !isValidRustIdentifier(crateName)) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        `crate attribute '${String(crateName)}' is not a valid Rust crate identifier.`,
      ));
      continue;
    }
    const registryPatch = attributes[cargoRegistryPatchAttributeName];
    if (registryPatch !== undefined && registryPatch !== cargoCratesIoRegistry) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        `registry patch '${String(registryPatch)}' is unsupported.`,
        [`runtime.reference.crate=${crateName}`],
      ));
      continue;
    }
    const materialized = materializeCargoCrate(reference.include, crateName);
    if ("reason" in materialized) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        materialized.reason,
        materialized.details,
      ));
      continue;
    }
    const dependency: CargoDependency = {
      name: crateName,
      path: materialized.path,
      ...(registryPatch === cargoCratesIoRegistry ? { registryPatch } : {}),
    };
    const existing = dependenciesByName.get(crateName);
    if (existing !== undefined &&
      (existing.path !== dependency.path || existing.registryPatch !== dependency.registryPatch)) {
      diagnostics.push(missingRuntimeReferenceDiagnostic(reference.kind, reference.include));
      continue;
    }
    dependenciesByName.set(crateName, Object.freeze(dependency));
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }
  return {
    manifest: Object.freeze({
      packageName: configuration.crateName,
      edition: configuration.edition,
      outputType: configuration.outputType,
      dependencies: Object.freeze(
        [...dependenciesByName.values()].sort((left, right) => left.name.localeCompare(right.name, "en")),
      ),
      workspace: Object.freeze({ members: Object.freeze([]) }),
    }),
    diagnostics: [],
  };
}
