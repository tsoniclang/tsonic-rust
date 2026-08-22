import { cargoCrateAttributeName, cargoPathReferenceKind, cargoRegistryPatchAttributeName } from "../../target-model/project/cargo-reference.js";
import { collectRustProviderSemantics } from "./semantics.js";
import { createRustProviderPackageSourceExtension, rustProviderBindingProviderId } from "./source-provider.js";
import { rustProviderPolicyContributionKind } from "./model.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { validateProviderPackageDefinition } from "./validation.js";
import type {
  SelectedTargetCapabilityContributions,
  TargetRuntimeContributionContext,
} from "@tsonic/target-api/provider";
import type {
  TargetRuntimeContributions,
  TargetRuntimeReference,
} from "@tsonic/target-api/artifacts";
import type { CompilerExtension } from "@tsonic/tsts";
import type { RustProviderOperationRow, RustProviderPackageDefinition, RustProviderPackageImplementation, RustProviderPolicyContribution } from "./model.js";

export function createRustProviderPackage(definition: RustProviderPackageDefinition): RustProviderPackageImplementation {
  let closedDefinition: RustProviderPackageDefinition;
  try {
    closedDefinition = snapshotClosedMetadata(definition);
  } catch (error) {
    throw new Error(`Provider package '${String(definition.id)}': ${error instanceof Error ? error.message : String(error)}`);
  }
  validateProviderPackageDefinition(closedDefinition);
  const bindingProviderId = rustProviderBindingProviderId(closedDefinition.id);
  return Object.freeze({
    kind: "target-capability",
    targetId: "rust",
    id: closedDefinition.id,
    displayName: closedDefinition.displayName,
    ...(closedDefinition.requiredSurfaces === undefined ? {} : { requiredSurfaces: closedDefinition.requiredSurfaces }),
    moduleOwnership: Object.freeze([
      ...closedDefinition.modules.map((module) => module.moduleSpecifier),
      ...(closedDefinition.moduleAliases ?? []).map((alias) => alias.moduleSpecifier),
    ].map((specifierPrefix) => Object.freeze({
      specifierPrefix,
      providerId: bindingProviderId,
    }))),
    sourceCompilerContributions(): { readonly extensions: readonly CompilerExtension[] } {
      return { extensions: [createRustProviderPackageSourceExtension(closedDefinition)] };
    },
    runtimeContributions(_context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return {
        references: closedDefinition.crates.map((crate): TargetRuntimeReference => ({
          kind: cargoPathReferenceKind,
          include: crate.cargoPath,
          attributes: {
            [cargoCrateAttributeName]: crate.crateName,
            ...(crate.registryPatch === undefined
              ? {}
              : { [cargoRegistryPatchAttributeName]: crate.registryPatch }),
          },
        })),
      };
    },
    createTargetContributions(): readonly RustProviderPolicyContribution[] {
      return [Object.freeze({
        kind: rustProviderPolicyContributionKind,
        contractVersion: 1 as const,
        definition: closedDefinition,
      })];
    },
  });
}

export function collectRustProviderOperationRows(
  capabilities: readonly SelectedTargetCapabilityContributions[],
): readonly RustProviderOperationRow[] {
  return collectRustProviderSemantics(capabilities).operations;
}
