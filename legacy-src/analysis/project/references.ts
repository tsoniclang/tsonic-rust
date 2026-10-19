import type {
  TargetDiagnostic,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import {
  cargoCrateAttributeName,
  cargoDefaultFeaturesAttributeName,
  cargoFeaturesAttributeName,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
  rustMinimumFoundationAttributeName,
} from "../../target-model/project/cargo-reference.js";
import {
  cargoCratesIoRegistry,
  type RustCargoDependency,
} from "../../target-model/project/model.js";
import {
  isValidRustIdentifier,
} from "../../target-model/names/identifiers.js";
import { materializeCargoCrate } from "./cargo-package.js";
import {
  isRustFoundation,
  rustFoundationIncludes,
  type RustFoundation,
} from "../../target-model/foundation/model.js";

export interface RustRuntimeReferencePlan {
  readonly cargoDependencies: readonly RustCargoDependency[];
  readonly activeCrates: readonly string[];
  readonly foundation: RustFoundation;
  readonly minimumFoundationByCrate: ReadonlyMap<string, RustFoundation>;
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
  foundation: RustFoundation,
): RustRuntimeReferenceAnalysisResult {
  const diagnostics: TargetDiagnostic[] = [];
  const dependenciesByName = new Map<string, RustCargoDependency>();
  const minimumFoundationByCrate = new Map<string, RustFoundation>();
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
      key !== cargoRegistryPatchAttributeName &&
      key !== cargoDefaultFeaturesAttributeName &&
      key !== cargoFeaturesAttributeName &&
      key !== rustMinimumFoundationAttributeName
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
    const minimumFoundationValue = attributes[rustMinimumFoundationAttributeName] ?? "std";
    if (!isRustFoundation(minimumFoundationValue)) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        `minimum foundation '${String(minimumFoundationValue)}' is not 'core', 'alloc', or 'std'.`,
        [`runtime.reference.crate=${crateName}`],
      ));
      continue;
    }
    if (!rustFoundationIncludes(foundation, minimumFoundationValue)) {
      diagnostics.push({
        code: "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED",
        category: "error",
        source: "tsonic-rust",
        message: `Rust crate '${crateName}' requires '${minimumFoundationValue}', but the target selected '${foundation}'.`,
        evidence: [
          "target.capability=rust.foundation",
          `rust.foundation.selected=${foundation}`,
          `rust.foundation.required=${minimumFoundationValue}`,
          `runtime.reference.crate=${crateName}`,
        ],
      });
      continue;
    }
    const defaultFeaturesValue = attributes[cargoDefaultFeaturesAttributeName];
    if (defaultFeaturesValue !== undefined &&
      defaultFeaturesValue !== "true" && defaultFeaturesValue !== "false") {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        `defaultFeatures attribute '${String(defaultFeaturesValue)}' must be 'true' or 'false'.`,
        [`runtime.reference.crate=${crateName}`],
      ));
      continue;
    }
    const features = parseCargoFeatures(attributes[cargoFeaturesAttributeName]);
    if (features === undefined) {
      diagnostics.push(invalidCargoRuntimeReferenceDiagnostic(
        reference.include,
        "features attribute must be a canonical JSON array of distinct non-empty strings.",
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
      ...(defaultFeaturesValue === undefined
        ? {}
        : { defaultFeatures: defaultFeaturesValue === "true" }),
      ...(features.length === 0 ? {} : { features }),
    });
    const existing = dependenciesByName.get(crateName);
    const existingMinimumFoundation = minimumFoundationByCrate.get(crateName);
    if (
      existing !== undefined &&
      (
        existing.path !== dependency.path ||
        existing.registryPatch !== dependency.registryPatch
        || existing.defaultFeatures !== dependency.defaultFeatures
        || !sameStrings(existing.features, dependency.features)
        || existingMinimumFoundation !== minimumFoundationValue
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
    minimumFoundationByCrate.set(crateName, minimumFoundationValue);
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
      foundation,
      minimumFoundationByCrate: new Map(minimumFoundationByCrate),
    }),
  };
}

function parseCargoFeatures(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) {
    return Object.freeze([]);
  }
  let parsed: unknown = undefined;
  let parsedSuccessfully = true;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsedSuccessfully = false;
  }
  if (!parsedSuccessfully || !Array.isArray(parsed) || parsed.some((entry) =>
    typeof entry !== "string" || entry.length === 0)) {
    return undefined;
  }
  const features = [...parsed] as string[];
  const canonical = [...new Set(features)].sort((left, right) =>
    left.localeCompare(right, "en"));
  return canonical.length === features.length &&
      canonical.every((feature, index) => feature === features[index])
    ? Object.freeze(canonical)
    : undefined;
}

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
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
