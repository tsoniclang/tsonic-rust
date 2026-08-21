import type {
  TargetDiagnostic,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import {
  cargoCrateAttributeName,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
} from "../../target-model/project/cargo-reference.js";
import {
  cargoCratesIoRegistry,
  type RustCargoDependency,
} from "../../target-model/project/model.js";
import {
  isValidRustIdentifier,
} from "../../target-model/names/identifiers.js";
import { materializeCargoCrate } from "./cargo-package.js";

export interface RustRuntimeReferencePlan {
  readonly cargoDependencies: readonly RustCargoDependency[];
  readonly activeCrates: readonly string[];
}

export type RustRuntimeReferenceAnalysisResult =
  | {
      readonly kind: "resolved";
      readonly plan: RustRuntimeReferencePlan;
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    };

export function analyzeRustRuntimeReferences(
  runtimeReferences: readonly TargetRuntimeReference[],
): RustRuntimeReferenceAnalysisResult {
  const diagnostics: TargetDiagnostic[] = [];
  const dependenciesByName = new Map<string, RustCargoDependency>();
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
      diagnostics.push(unsupportedRuntimeReferenceDiagnostic(
        reference.kind,
        reference.include,
      ));
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
    if (
      attributes === undefined ||
      attributes === null ||
      typeof attributes !== "object" ||
      Array.isArray(attributes)
    ) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        "attributes must be an object containing an explicit crate identity.",
      ));
      continue;
    }
    const unsupportedAttribute = Object.keys(attributes).find((key) =>
      key !== cargoCrateAttributeName &&
      key !== cargoRegistryPatchAttributeName
    );
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
    const dependency: RustCargoDependency = Object.freeze({
      name: crateName,
      path: materialized.path,
      ...(registryPatch === cargoCratesIoRegistry ? { registryPatch } : {}),
    });
    const existing = dependenciesByName.get(crateName);
    if (
      existing !== undefined &&
      (
        existing.path !== dependency.path ||
        existing.registryPatch !== dependency.registryPatch
      )
    ) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        `crate '${crateName}' is bound to incompatible runtime references.`,
        [
          `runtime.reference.crate=${crateName}`,
          `runtime.reference.existing=${existing.path}`,
          `runtime.reference.conflicting=${dependency.path}`,
        ],
      ));
      continue;
    }
    dependenciesByName.set(crateName, dependency);
  }
  if (diagnostics.length > 0) {
    return {
      kind: "rejected",
      diagnostics: Object.freeze(diagnostics),
    };
  }
  const cargoDependencies = Object.freeze(
    [...dependenciesByName.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "en")
    ),
  );
  return {
    kind: "resolved",
    plan: Object.freeze({
      cargoDependencies,
      activeCrates: Object.freeze(cargoDependencies.map((entry) => entry.name)),
    }),
  };
}

function unsupportedRuntimeReferenceDiagnostic(
  kind: string,
  include: string,
): TargetDiagnostic {
  return {
    code: "RUST_UNSUPPORTED_RUNTIME_REFERENCE",
    category: "error",
    source: "tsonic-rust",
    message: `The Rust target cannot map runtime reference kind '${kind}' to a Cargo dependency.`,
    evidence: [
      "target.capability=rust.toolchain.runtime-reference",
      `runtime.reference.kind=${kind}`,
      `runtime.reference.include=${include}`,
    ],
  };
}

function invalidCargoRuntimeReferenceDiagnostic(
  include: unknown,
  reason: string,
  details: readonly string[] = [],
): TargetDiagnostic {
  return {
    code: "RUST_INVALID_CARGO_REFERENCE",
    category: "error",
    source: "tsonic-rust",
    message: `The Rust target rejected a Cargo path runtime reference: ${reason}`,
    evidence: [
      "target.capability=rust.toolchain.runtime-reference",
      `runtime.reference.include=${String(include)}`,
      ...details,
    ],
  };
}
