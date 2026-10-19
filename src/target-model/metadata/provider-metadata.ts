import type {
  RustProviderExportRow,
  RustProviderOperationRow,
  RustProviderTypeRow,
} from "../identities/provider-relations.js";
import type { RustFallibleErrorBoundary } from "../operations/error-boundary.js";
import type {
  RustDispatchContextDefinition,
  RustDispatchContextGroupInput,
} from "../operations/dispatch-contexts.js";
import type { RustNamedTypeTraitContract, TargetTypeRef } from "../types/model.js";

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
