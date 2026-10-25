import type { ProviderDeclarationKind } from "@tsonic/tsts";
import type { RustFallibleErrorBoundary } from "../operations/error-boundary.js";
import type { RustDispatchContextInput } from "../operations/dispatch-contexts.js";
import type { RustCallbackOperationTemplate, RustProviderGenericParameter, RustProviderOperationForm, RustProviderTypeParameterRequirement, RustValueConversion } from "../operations/model.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../types/model.js";

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
  readonly resultError: Extract<RustCallbackOperationTemplate["failure"], { readonly kind: "invocation" }>["resultError"];
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
