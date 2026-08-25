import type { RustRuntimeReferencePlan } from "../../../analysis/runtime/index.js";
import type { RustTargetConfigurationInput } from "../../../target-model/configuration/model.js";
import type { CargoManifestPlan } from "../../artifact-model/project/cargo.js";

export type RustCargoProjectPlan =
  | { readonly kind: "generated"; readonly manifest: CargoManifestPlan }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export function planRustCargoProject(
  configuration: RustTargetConfigurationInput,
  runtimeReferences: RustRuntimeReferencePlan,
): RustCargoProjectPlan {
  return configuration.project.kind === "generated"
    ? {
        kind: "generated",
        manifest: planCargoManifest(configuration, runtimeReferences),
      }
    : {
        kind: "user-owned",
        manifestPath: configuration.project.manifestPath,
      };
}

export function planCargoManifest(
  configuration: RustTargetConfigurationInput,
  runtimeReferences: RustRuntimeReferencePlan,
): CargoManifestPlan {
  return Object.freeze({
    packageName: configuration.crateName,
    edition: configuration.edition,
    outputType: configuration.outputType,
    dependencies: runtimeReferences.cargoDependencies,
    workspace: Object.freeze({ members: Object.freeze([]) }),
  });
}
