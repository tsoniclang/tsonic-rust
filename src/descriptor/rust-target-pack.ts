import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import type {
  TargetBackend,
  TargetBackendContext,
  TargetPack,
  TargetProviderContext,
  TargetRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetRuntimeReference,
  TargetSelection,
  TargetSourceCompilerContributions,
  TargetToolchain,
  TargetToolchainContext,
} from "@tsonic/target-api";
import { createRustBackend } from "../backend/rust-backend.js";
import {
  cargoCrateAttributeName,
  cargoCratesIoRegistry,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
} from "../backend/planner/cargo-project.js";
import {
  readRustTypescriptCompatibilityMode,
  validateRustTargetOptions,
} from "../options/rust-target-options.js";
import { createCargoToolchain } from "../toolchain/cargo-toolchain.js";
import {
  rustJsSurfaceSourceProfileContributions,
  rustSourceProfileContributions,
} from "../source/rust-target-semantics/source-profile-declarations.js";
import {
  createRustSourceSemanticsExtension,
} from "../source/rust-source-semantics/source-extension.js";
import {
  rustSourceSemanticsModules,
} from "../source/rust-source-semantics/source-modules.js";
import {
  createRustCompilerProviderSession,
  rustCompilerProviderSpecifierPrefix,
} from "../providers/compiler/session.js";
import type { RustCompilerProviderSession } from "../providers/compiler/session.js";
import { readRustUserProjectFile } from "../options/rust-target-options.js";

export const rustTargetId = "rust";
const require = createRequire(import.meta.url);

// The pack declares only what is implemented; undeclared surfaces and
// provider packages fail at the host.
export function createRustTargetPack(): TargetPack {
  const compilerSessions = new WeakMap<TargetSelection, RustCompilerProviderSession>();
  return {
    id: rustTargetId,
    displayName: "Rust",
    provider: {
      id: "rust-provider",
      displayName: "Rust target provider",
      moduleOwnership: [
        { specifierPrefix: "@tsonic/rust/std/" },
        { specifierPrefix: rustCompilerProviderSpecifierPrefix },
      ],
      sourceProfileContributions: rustSourceProfileContributions,
      sourceCompilerContributions(
        context: TargetProviderContext,
      ): TargetSourceCompilerContributions {
        validateRustTargetOptions(context.target);
        const compilerSession = createRustCompilerProviderSession(context);
        compilerSessions.set(context.target, compilerSession);
        return {
          semanticsModules: rustSourceSemanticsModules(),
          extensions: [createRustSourceSemanticsExtension(compilerSession.sourceProviders)],
        };
      },
      runtimeContributions(context: TargetRuntimeContributionContext): TargetRuntimeContributions {
        return {
          references: [
            rustRuntimeCrateReference(context, "@tsonic/rust-runtime", "tsonic_rust_runtime"),
            ...rustTypescriptCompatibilityRuntimeReferences(context),
          ],
        };
      },
    },
    surfaces: [
      {
        id: "js",
        displayName: "JavaScript surface",
        sourceProfileContributions: rustJsSurfaceSourceProfileContributions,
        runtimeContributions(_context: TargetRuntimeContributionContext): TargetRuntimeContributions {
          return {
            references: [rustRuntimeCrateReference(_context, "@tsonic/rust-js", "tsonic_rust_js")],
          };
        },
      },
    ],
    createBackend(context: TargetBackendContext): TargetBackend {
      validateRustTargetOptions(context.target);
      const compilerSession = compilerSessions.get(context.target);
      if (readRustUserProjectFile(context.target) !== undefined && compilerSession === undefined) {
        throw new Error("Rust user-owned Cargo mode requires source compilation to establish one immutable compiler-provider session before backend planning.");
      }
      compilerSessions.delete(context.target);
      return createRustBackend(context, compilerSession?.semantics());
    },
    createToolchain(context: TargetToolchainContext): TargetToolchain {
      validateRustTargetOptions(context.target);
      return createCargoToolchain(context);
    },
  };
}

function rustRuntimeCrateReference(
  context: TargetRuntimeContributionContext,
  packageName: string,
  crateName: string,
): TargetRuntimeReference {
  const packageRoot = resolveRuntimePackageRoot(context, packageName);
  return {
    kind: cargoPathReferenceKind,
    include: resolve(packageRoot, `crates/${crateName}`),
    attributes: {
      [cargoCrateAttributeName]: crateName,
      [cargoRegistryPatchAttributeName]: cargoCratesIoRegistry,
    },
  };
}

function resolveRuntimePackageRoot(context: TargetRuntimeContributionContext, packageName: string): string {
  const packageJsonSpecifier = `${packageName}/package.json`;
  const projectRequire = createRequire(resolve(context.paths.projectRoot, "package.json"));
  for (const resolver of [projectRequire, require]) {
    try {
      return dirname(resolver.resolve(packageJsonSpecifier));
    } catch {
      continue;
    }
  }
  throw new Error(`Required Rust runtime package '${packageName}' is not installed or does not export package.json.`);
}

function rustTypescriptCompatibilityRuntimeReferences(context: TargetRuntimeContributionContext): readonly TargetRuntimeReference[] {
  if (readRustTypescriptCompatibilityMode(context.target) !== "compat" || context.selectedSurfaces.some((surface) => surface.id === "js")) {
    return [];
  }
  return [rustRuntimeCrateReference(context, "@tsonic/rust-js", "tsonic_rust_js")];
}
