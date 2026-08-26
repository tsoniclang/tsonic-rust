import type { ProviderDeclarationKind, ProviderExportDeclaration } from "@tsonic/tsts";
import type { RustFallibleErrorBoundary } from "../../target-model/operations/error-boundary.js";
import type { RustNamedTypeTraitContract } from "../../target-model/types/model.js";
import type {
  RustProviderGenericParameter,
  RustProviderOperationForm,
  RustProviderTypeParameterRequirement,
  RustValueConversion,
} from "../../target-model/operations/model.js";
import type {
  TargetCapabilityContribution,
  TargetCapabilityImplementation,
} from "@tsonic/target-api/provider";
import type {
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../target-model/types/model.js";

export interface RustProviderModuleDefinition {
  readonly moduleSpecifier: string;
  readonly providerModuleId: string;
  // Cross-module type references (e.g. crypto returning buffer's Buffer).
  readonly imports?: readonly { readonly moduleSpecifier: string; readonly namedImports: readonly { readonly exportedName: string }[] }[];
  readonly exports: readonly ProviderExportDeclaration[];
}

export type RustProviderOperationKind =
  | "method"
  | "constructor"
  | "property"
  | "indexer"
  | "property-set"
  | "index-set";

export interface RustProviderImmediateCallbackDefinition {
  readonly sourceArgumentIndex: number;
  readonly fallibleTarget: RustProviderOperationForm;
}

interface RustProviderOperationDefinitionBase<
  OperationKind extends RustProviderOperationKind = RustProviderOperationKind,
> {
  readonly exportId: string;
  readonly memberId?: string;
  readonly signatureId?: string;
  readonly operationKind: OperationKind;
  readonly target: RustProviderOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly TargetTypeRef[];
  readonly receiverCarrier?: TargetTypeRef;
  readonly genericParameters?: readonly RustProviderGenericParameter[];
  readonly typeRequirements?: readonly RustProviderTypeParameterRequirement[];
  readonly targetGenericArguments?: readonly RustTargetGenericArgument[];
  readonly resultConversion?: RustValueConversion;
  readonly evaluation?: "pure";
  // Async provider operations produce future carriers that must be awaited.
  readonly isAsync?: boolean;
  // Exact target invocation safety. This does not grant a lexical unsafe
  // context; source code must still select an explicit unsafeContext region.
  readonly isUnsafe?: boolean;
  readonly immediateCallback?: RustProviderImmediateCallbackDefinition;
}

export type RustProviderOperationDefinition<
  OperationKind extends RustProviderOperationKind = RustProviderOperationKind,
> = RustProviderOperationDefinitionBase<OperationKind> & (
  | {
      readonly isFallible: true;
      readonly errorBoundary: "provider-native";
      readonly errorCarrier: TargetTypeRef;
    }
  | {
      readonly isFallible: true;
      readonly errorBoundary: Exclude<RustFallibleErrorBoundary, "provider-native">;
      readonly errorCarrier?: never;
    }
  | {
      readonly isFallible?: false;
      readonly errorBoundary?: never;
      readonly errorCarrier?: never;
    }
);

export interface RustProviderTypeDefinition {
  readonly exportId: string;
  readonly genericParameters?: readonly RustProviderGenericParameter[];
  readonly targetCarrier: TargetTypeRef;
  readonly typeRequirements?: readonly RustProviderTypeParameterRequirement[];
  readonly objectLiteralConstruction?: {
    readonly kind: "struct-default";
  };
}

export interface RustProviderTypeRow extends RustProviderTypeDefinition {
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export type RustProviderOperationRow<
  OperationKind extends RustProviderOperationKind = RustProviderOperationKind,
> = RustProviderOperationDefinition<OperationKind> & {
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
};

export interface RustProviderExportRow {
  readonly exportId: string;
  readonly declarationKind: ProviderDeclarationKind;
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export interface RustProviderSemantics {
  readonly exports: readonly RustProviderExportRow[];
  readonly operations: readonly RustProviderOperationRow[];
  readonly carrierPaths: Readonly<Record<string, string>>;
  readonly carrierTraits: Readonly<Record<string, RustNamedTypeTraitContract>>;
  readonly types: readonly RustProviderTypeRow[];
  readonly binaryEpilogues: readonly RustProviderBinaryEpilogueRow[];
}

export interface RustProviderCrateDefinition {
  readonly crateName: string;
  readonly cargoPath: string;
  readonly registryPatch?: "crates-io";
}

export interface RustProviderSourceDependency {
  readonly moduleSpecifier: string;
  readonly exportedNames: readonly string[];
}

export interface RustProviderModuleAliasDefinition {
  readonly moduleSpecifier: string;
  readonly canonicalModuleSpecifier: string;
}

interface RustProviderBinaryEpilogueDefinitionBase {
  readonly id: string;
  readonly path: string;
  readonly requiredCrate: string;
}

export type RustProviderBinaryEpilogueDefinition =
  & RustProviderBinaryEpilogueDefinitionBase
  & (
    | {
        readonly isFallible: true;
        readonly errorBoundary: "provider-native";
        readonly errorCarrier: TargetTypeRef;
      }
    | {
        readonly isFallible: true;
        readonly errorBoundary: Exclude<RustFallibleErrorBoundary, "provider-native">;
        readonly errorCarrier?: never;
      }
    | {
        readonly isFallible?: false;
        readonly errorBoundary?: never;
        readonly errorCarrier?: never;
      }
  );

export type RustProviderBinaryEpilogueRow = RustProviderBinaryEpilogueDefinition & {
  readonly providerPackageId: string;
  readonly providerVersion: string;
};

export interface RustProviderPackageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly requiredSurfaces?: readonly string[];
  readonly sourceDependencies?: readonly RustProviderSourceDependency[];
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
  readonly binaryEpilogues?: readonly RustProviderBinaryEpilogueDefinition[];
}

export const rustProviderPolicyContributionKind = "rust-provider-policy";

export interface RustProviderPolicyContribution extends TargetCapabilityContribution {
  readonly kind: typeof rustProviderPolicyContributionKind;
  readonly contractVersion: 1;
  readonly definition: RustProviderPackageDefinition;
}

export type RustProviderPackageImplementation = TargetCapabilityImplementation;
