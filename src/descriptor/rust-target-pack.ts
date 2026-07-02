import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  TargetBackend,
  TargetBackendContext,
  TargetPack,
  TargetProviderContext,
  TargetRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetRuntimeReference,
  TargetToolchain,
  TargetToolchainContext,
} from "@tsonic/target-api";
import type { CompilerExtension } from "@tsonic/tsts";
import { createRustBackend } from "../backend/rust-backend.js";
import { createRustTargetSemanticsExtension } from "../source/rust-target-semantics/index.js";
import { cargoCrateAttributeName, cargoPathReferenceKind } from "../backend/planner/cargo-project.js";
import {
  readRustTypescriptCompatibilityMode,
  validateRustTargetOptions,
} from "../options/rust-target-options.js";
import { createCargoToolchain } from "../toolchain/cargo-toolchain.js";

export const rustTargetId = "rust";
const targetPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Slice R1: provider-only pack. The js surface (rust-js) and nodejs provider
// package (rust-nodejs) are added by their own slices; until then selecting
// them fails at the host because the pack does not declare them.
export function createRustTargetPack(): TargetPack {
  return {
    id: rustTargetId,
    displayName: "Rust",
    provider: {
      id: "rust-provider",
      displayName: "Rust target provider",
      createExtensions(context: TargetProviderContext): readonly CompilerExtension[] {
        validateRustTargetOptions(context.target);
        return [createRustTargetSemanticsExtension(context)];
      },
      runtimeContributions(context: TargetRuntimeContributionContext): TargetRuntimeContributions {
        return {
          references: [
            rustRuntimeCrateReference("rust-runtime", "tsonic_rust_runtime"),
            ...rustTypescriptCompatibilityRuntimeReferences(context),
          ],
        };
      },
    },
    createBackend(context: TargetBackendContext): TargetBackend {
      validateRustTargetOptions(context.target);
      return createRustBackend(context);
    },
    createToolchain(context: TargetToolchainContext): TargetToolchain {
      validateRustTargetOptions(context.target);
      return createCargoToolchain(context);
    },
  };
}

function rustRuntimeCrateReference(repositoryName: string, crateName: string): TargetRuntimeReference {
  return {
    kind: cargoPathReferenceKind,
    include: resolve(targetPackageRoot, `../${repositoryName}/crates/${crateName}`),
    attributes: { [cargoCrateAttributeName]: crateName },
  };
}

function rustTypescriptCompatibilityRuntimeReferences(context: TargetRuntimeContributionContext): readonly TargetRuntimeReference[] {
  if (readRustTypescriptCompatibilityMode(context.target) !== "compat" || context.selectedSurfaces.some((surface) => surface.id === "js")) {
    return [];
  }
  return [rustRuntimeCrateReference("rust-js", "tsonic_rust_js")];
}
