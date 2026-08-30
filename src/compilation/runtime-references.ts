import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type {
  TargetCompilationSessionContext,
} from "@tsonic/target-api";
import type {
  TargetRuntimeContributionContext,
} from "@tsonic/target-api/provider";
import type {
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import {
  cargoCrateAttributeName,
  cargoDefaultFeaturesAttributeName,
  cargoFeaturesAttributeName,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
  encodeCargoFeatures,
  rustMinimumFoundationAttributeName,
} from "../target-model/project/cargo-reference.js";
import { cargoCratesIoRegistry } from "../target-model/project/model.js";
import type { RustFoundation } from "../target-model/foundation/model.js";

const require = createRequire(import.meta.url);

export function rustRuntimeCrateReference(
  context: Pick<TargetCompilationSessionContext, "paths"> |
    Pick<TargetRuntimeContributionContext, "paths">,
  packageName: string,
  crateName: string,
  options: {
    readonly minimumFoundation: RustFoundation;
    readonly defaultFeatures?: boolean;
    readonly features?: readonly string[];
  },
): TargetRuntimeReference {
  const packageRoot = resolveRuntimePackageRoot(context, packageName);
  return Object.freeze({
    kind: cargoPathReferenceKind,
    include: resolve(packageRoot, `crates/${crateName}`),
    attributes: Object.freeze({
      [cargoCrateAttributeName]: crateName,
      [cargoRegistryPatchAttributeName]: cargoCratesIoRegistry,
      [rustMinimumFoundationAttributeName]: options.minimumFoundation,
      ...(options.defaultFeatures === undefined
        ? {}
        : { [cargoDefaultFeaturesAttributeName]: String(options.defaultFeatures) }),
      ...(options.features === undefined
        ? {}
        : { [cargoFeaturesAttributeName]: encodeCargoFeatures(options.features) }),
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
  throw new Error(
    `Required Rust runtime package '${packageName}' is not installed or does not export package.json.`,
  );
}
