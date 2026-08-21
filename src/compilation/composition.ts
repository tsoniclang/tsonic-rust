import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type {
  TargetProviderDescriptor,
  TargetSelection,
  TargetSurfaceImplementation,
} from "@tsonic/target-api";
import type {
  TargetRuntimeContributionContext,
} from "@tsonic/target-api/provider";
import type {
  TargetRuntimeContributions,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import { rustCompilerProviderSpecifierPrefix } from "../providers/compiler/session.js";
import {
  cargoCrateAttributeName,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
} from "../providers/model/cargo-reference.js";
import { rustJsSurfaceSourceProfileContributions } from "../source/profiles/declarations.js";
import { cargoCratesIoRegistry } from "../target-model/project/model.js";

const require = createRequire(import.meta.url);

export const rustTargetProvider: TargetProviderDescriptor = Object.freeze({
  id: "rust-provider",
  displayName: "Rust target provider",
  moduleOwnership: Object.freeze([
    Object.freeze({ specifierPrefix: "@tsonic/rust/std/" }),
    Object.freeze({ specifierPrefix: rustCompilerProviderSpecifierPrefix }),
  ]),
});

export const rustTargetSurfaces: readonly TargetSurfaceImplementation[] = Object.freeze([
  Object.freeze({
    id: "js",
    displayName: "JavaScript surface",
    sourceProfileContributions: rustJsSurfaceSourceProfileContributions,
    runtimeContributions(context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return Object.freeze({
        references: Object.freeze([
          rustRuntimeCrateReference(context, "@tsonic/rust-js", "tsonic_rust_js"),
        ]),
      });
    },
  }),
]);

function rustRuntimeCrateReference(
  context: { readonly target: TargetSelection; readonly paths: { readonly projectRoot: string } },
  packageName: string,
  crateName: string,
): TargetRuntimeReference {
  const packageRoot = resolveRuntimePackageRoot(context, packageName);
  return Object.freeze({
    kind: cargoPathReferenceKind,
    include: resolve(packageRoot, `crates/${crateName}`),
    attributes: Object.freeze({
      [cargoCrateAttributeName]: crateName,
      [cargoRegistryPatchAttributeName]: cargoCratesIoRegistry,
    }),
  });
}

function resolveRuntimePackageRoot(
  context: { readonly paths: { readonly projectRoot: string } },
  packageName: string,
): string {
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
