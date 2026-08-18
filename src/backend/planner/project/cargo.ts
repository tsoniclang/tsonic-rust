import type { TargetSelection } from "@tsonic/target-api";
import type {
  TargetDiagnostic,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import type { TargetCompilationPaths } from "@tsonic/target-api";
import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { materializeCargoCrate } from "../../../providers/model/cargo-package.js";
import {
  readRustCrateName,
  readRustEdition,
  readRustOutputType,
} from "../../../options/rust-target-options.js";
import type { CargoDependency, CargoManifestPlan } from "../../project-model/cargo.js";
import { resolveRustUserCargoManifest } from "../../../options/rust-user-project.js";
import {
  invalidCargoRuntimeReferenceDiagnostic,
  missingRuntimeReferenceDiagnostic,
} from "../diagnostics.js";
import { isValidRustIdentifier } from "../program/plan-context.js";
import {
  cargoCrateAttributeName,
  cargoCratesIoRegistry,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
} from "../../../providers/model/cargo-reference.js";

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
  target: TargetSelection,
  paths: TargetCompilationPaths,
  runtimeReferences: readonly TargetRuntimeReference[],
): RustCargoProjectPlanResult {
  const resolution = resolveRustUserCargoManifest(target, dirname(paths.projectFilePath));
  if (resolution.kind === "absent") {
    const generated = planCargoManifest(target, runtimeReferences);
    return generated.manifest === undefined
      ? { diagnostics: generated.diagnostics }
      : { project: { kind: "generated", manifest: generated.manifest }, diagnostics: [] };
  }
  if (resolution.kind === "invalid") {
    return { diagnostics: [userCargoProjectDiagnostic(resolution.message, resolution.path)] };
  }
  const diagnostic = validateUserCargoManifestLocation(paths, resolution.manifestPath);
  return diagnostic === undefined
    ? { project: { kind: "user-owned", manifestPath: resolution.manifestPath }, diagnostics: [] }
    : { diagnostics: [diagnostic] };
}

export function planCargoManifest(
  target: TargetSelection,
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
    dependenciesByName.set(crateName, dependency);
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

function validateUserCargoManifestLocation(
  paths: TargetCompilationPaths,
  manifestPath: string,
): TargetDiagnostic | undefined {
  const outputRoot = canonicalExistingPath(paths.targetOutputRoot);
  const relativeToOutput = normalizePath(relative(outputRoot, manifestPath));
  if (relativeToOutput.length === 0 || relativeToOutput === "." ||
    (!relativeToOutput.startsWith("../") && relativeToOutput !== "..")) {
    return userCargoProjectDiagnostic(
      `Rust target option 'projectFile' must not point inside generated target output root '${paths.targetOutputRoot}': ${manifestPath}`,
      manifestPath,
    );
  }
  return undefined;
}

function canonicalExistingPath(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    return resolved;
  }
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function userCargoProjectDiagnostic(message: string, manifestPath: string): TargetDiagnostic {
  return {
    code: "RUST_USER_PROJECT_INVALID",
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: [
      `projectFile: ${manifestPath}`,
      "Tsonic emits Rust source in user-owned Cargo mode but never creates or mutates the native Cargo manifest.",
    ],
  };
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}
