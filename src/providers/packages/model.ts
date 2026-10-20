import type { ProviderExportDeclaration } from "@tsonic/tsts";
import type { RustNamedTypeTraitContract } from "../../target-model/types/model.js";
import type { RustProviderOperationDefinition, RustProviderTypeDefinition } from "../../target-model/identities/provider-relations.js";
import type { RustProviderBinaryHookDefinition } from "../../target-model/metadata/provider-metadata.js";
import type { TargetCapabilityContribution, TargetCapabilityImplementation } from "@tsonic/target-api/provider";
import type { RustFoundation } from "../../target-model/foundation/model.js";
import type { RustDispatchContextDefinition } from "../../target-model/operations/dispatch-contexts.js";

export interface RustProviderModuleDefinition {
  readonly moduleSpecifier: string;
  readonly providerModuleId: string;
  // Cross-module type references (e.g. crypto returning buffer's Buffer).
  readonly imports?: readonly { readonly moduleSpecifier: string; readonly namedImports: readonly { readonly exportedName: string }[] }[];
  readonly exports: readonly ProviderExportDeclaration[];
}

export interface RustProviderCrateDefinition {
  readonly crateName: string;
  readonly cargoPath: string;
  readonly registryPatch?: "crates-io";
  readonly minimumFoundation?: RustFoundation;
  readonly defaultFeatures?: boolean;
  readonly features?: readonly string[];
}

export interface RustProviderSourceDependency {
  readonly moduleSpecifier: string;
  readonly exportedNames: readonly string[];
}

export interface RustProviderModuleAliasDefinition {
  readonly moduleSpecifier: string;
  readonly canonicalModuleSpecifier: string;
}

export interface RustProviderPackageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly requiredSurfaces?: readonly string[];
  readonly sourceDependencies?: readonly RustProviderSourceDependency[];
  readonly sourceGlobals?: Readonly<Record<string, string>>;
  readonly moduleAliases?: readonly RustProviderModuleAliasDefinition[];
  readonly modules: readonly RustProviderModuleDefinition[];
  readonly types?: readonly RustProviderTypeDefinition[];
  readonly operations: readonly RustProviderOperationDefinition[];
  readonly crates: readonly RustProviderCrateDefinition[];
  // Rust module aliases used by this capability's operation row paths
  // (e.g. acme_db_ext -> acme_db::ext). Emitted as use items.
  readonly aliasImports?: readonly { readonly alias: string; readonly path: string }[];
  // Rendered Rust paths for this capability's target-named carriers
  // (e.g. acme.db.Row -> acme_db::Row).
  readonly carrierPaths?: Readonly<Record<string, string>>;
  // Exact native trait guarantees for rendered named carriers. Missing rows
  // materialize as move-only; consumers never infer traits from Rust names.
  readonly carrierTraits?: Readonly<Record<string, RustNamedTypeTraitContract>>;
  readonly binaryHooks?: readonly RustProviderBinaryHookDefinition[];
  readonly dispatchContexts?: readonly RustDispatchContextDefinition[];
}

export const rustProviderPolicyContributionKind = "rust-provider-policy";

export interface RustProviderPolicyContribution extends TargetCapabilityContribution {
  readonly kind: typeof rustProviderPolicyContributionKind;
  readonly contractVersion: 1;
  readonly definition: RustProviderPackageDefinition;
}

export type RustProviderPackageImplementation = TargetCapabilityImplementation;
