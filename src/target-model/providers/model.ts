import type { ProviderDeclarationKind } from "@tsonic/tsts";
import type { RustFallibleErrorBoundary } from "../operations/error-boundary.js";
import type {
  RustDispatchContextDefinition,
  RustDispatchContextGroupInput,
  RustDispatchContextInput,
} from "../operations/dispatch-contexts.js";
import type {
  RustProviderGenericParameter,
  RustProviderOperationForm,
  RustProviderTypeParameterRequirement,
  RustValueConversion,
} from "../operations/model.js";
import type {
  RustNamedTypeTraitContract,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../types/model.js";

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
  readonly isAsync?: boolean;
  readonly isUnsafe?: boolean;
  readonly immediateCallback?: RustProviderImmediateCallbackDefinition;
  readonly dispatchInputs?: readonly RustDispatchContextInput[];
  readonly nativeErrorCarriers?: readonly TargetTypeRef[];
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
  readonly nativeMemoryFieldIds?: readonly string[];
  readonly exportId: string;
  readonly genericParameters?: readonly RustProviderGenericParameter[];
  readonly targetCarrier: TargetTypeRef;
  readonly typeRequirements?: readonly RustProviderTypeParameterRequirement[];
  readonly objectLiteralConstruction?: {
    readonly kind: "struct" | "struct-default" | "default";
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
  readonly globalNames?: readonly string[];
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
  readonly binaryHooks: readonly RustProviderBinaryHookRow[];
  readonly dispatchContexts: readonly RustProviderDispatchContextRow[];
}

export type RustProviderDispatchContextRow = RustDispatchContextDefinition & {
  readonly providerPackageId: string;
  readonly providerVersion: string;
};

interface RustProviderBinaryHookDefinitionBase {
  readonly id: string;
  readonly phase: import("../operations/binary-hooks.js").RustBinaryHookPhase;
  readonly path: string;
  readonly requiredCrate: string;
  readonly dispatchGroups?: readonly RustDispatchContextGroupInput[];
}

export type RustProviderBinaryHookDefinition =
  & RustProviderBinaryHookDefinitionBase
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

export type RustProviderBinaryHookRow = RustProviderBinaryHookDefinition & {
  readonly providerPackageId: string;
  readonly providerVersion: string;
};
