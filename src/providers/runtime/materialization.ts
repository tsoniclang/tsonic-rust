import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { TargetRuntimeReference } from "@tsonic/target-api/artifacts";
import type { MaterializedCargoCrate, RustRuntimeCrateAcquisitions } from "../model/runtime-crates.js";
import { cargoCrateAttributeName, cargoPathReferenceKind } from "../../target-model/project/cargo-reference.js";

export function materializeRustRuntimeReferences(references: readonly TargetRuntimeReference[]): RustRuntimeCrateAcquisitions {
  const acquired = new Map<TargetRuntimeReference, MaterializedCargoCrate>();
  for (const reference of references) {
    if (reference === undefined || typeof reference !== "object" || reference.kind !== cargoPathReferenceKind ||
      typeof reference.include !== "string" || reference.include.length === 0) continue;
    const attributes = reference.attributes;
    if (attributes === undefined || attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) continue;
    const crateName = attributes[cargoCrateAttributeName];
    if (typeof crateName !== "string") continue;
    acquired.set(reference, Object.freeze(materializeCargoCrate(reference.include, crateName)));
  }
  return acquired;
}

export function materializeCargoCrate(include: string, crateName: string): MaterializedCargoCrate {
  if (!isAbsolute(include) || normalize(include) !== include) {
    return {
      reason: "include must be an absolute normalized path.",
      details: [`runtime.reference.crate=${crateName}`],
    };
  }
  let canonicalPath: string;
  try {
    const stat = statSync(include);
    if (!stat.isDirectory()) {
      return {
        reason: "include does not identify a crate directory.",
        details: [`runtime.reference.crate=${crateName}`],
      };
    }
    canonicalPath = realpathSync.native(include);
  } catch (error) {
    return {
      reason: "crate directory cannot be read.",
      details: [
        `runtime.reference.crate=${crateName}`,
        `runtime.reference.error=${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const manifestPath = join(canonicalPath, "Cargo.toml");
  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, "utf8");
  } catch (error) {
    return {
      reason: "crate directory does not contain a readable Cargo.toml.",
      details: [
        `runtime.reference.crate=${crateName}`,
        `runtime.reference.manifest=${manifestPath}`,
        `runtime.reference.error=${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const declaredName = directCargoPackageName(manifestText);
  if (declaredName === undefined) {
    return {
      reason: "Cargo.toml must declare one direct literal '[package] name = \"...\"' identity.",
      details: [
        `runtime.reference.crate=${crateName}`,
        `runtime.reference.manifest=${manifestPath}`,
      ],
    };
  }
  if (declaredName !== crateName) {
    return {
      reason: `crate attribute '${crateName}' conflicts with Cargo package '${declaredName}'.`,
      details: [
        `runtime.reference.crate=${crateName}`,
        `runtime.reference.package=${declaredName}`,
        `runtime.reference.manifest=${manifestPath}`,
      ],
    };
  }
  return { path: canonicalPath };
}

function directCargoPackageName(manifestText: string): string | undefined {
  let inPackageSection = false;
  let packageName: string | undefined;
  for (const line of manifestText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("[")) {
      inPackageSection = trimmed === "[package]";
      continue;
    }
    if (!inPackageSection || !/^name\s*=/u.test(trimmed)) {
      continue;
    }
    const match = /^name\s*=\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*(?:#.*)?$/u.exec(trimmed);
    if (match === null || packageName !== undefined) {
      return undefined;
    }
    packageName = match[1];
  }
  return packageName;
}
