import type { RustProviderOperationRow, RustProviderTypeRow } from "../../../providers/packages/model.js";
import type { RustSourcePolicyContext } from "../../model/context.js";
import type { RustSourceProfileRegistry } from "../source-profile.js";
import type { RustSourceTypeRegistry } from "../source-type-registry.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { Node, SourceFile, Type, TypePropertyInfo } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceTypeFamilyImplementation } from "../../../target-model/types/type-families.js";

export interface RustTargetTypeResolutionOptions {
  readonly jsEnabled: boolean;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly RustProviderTypeRow[];
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly sourceErrorCarrier: (subject: SourceStorageSubject | undefined) => TargetTypeRef | undefined;
  readonly callableSignatureCarrier: (declaration: Node) => TargetTypeRef | undefined;
  readonly callableStorageCarrier: (
    subject: SourceStorageSubject,
    logicalCarrier: TargetTypeRef,
    environmentFor: (declaration: Node, excludedCaptures: ReadonlySet<Node>) => readonly TargetTypeRef[] | undefined,
    instanceFor: (declaration: Node) => TargetTypeRef | undefined,
  ) => TargetTypeRef | undefined;
  readonly projectCarrierSupportsObjectIdentity: (carrier: TargetTypeRef) => boolean;
  readonly projectFieldProjection: (property: TypePropertyInfo, owner: TargetTypeRef, ownerType: Type) => {
    readonly output: TargetTypeRef;
    readonly field: NonNullable<RustSourceTypeFamilyImplementation["field"]>;
  } | undefined;
  readonly resolveProjectUnionCarrier: (
    memberCarriers: readonly TargetTypeRef[],
  ) => TargetTypeRef | undefined;
}

export interface RustTargetTypeResolutionContext extends RustSourcePolicyContext {
  readonly sourceStorageSubject?: SourceStorageSubject;
  readonly currentSourceFile: SourceFile;
  readonly currentSemantics: SourceFileSemantics;
  readonly sourceTypeParameterSubstitutions?: ReadonlyMap<Node, RustSourceTypeArgument>;
}

export interface RustSourceTypeArgument {
  readonly sourceType: Type;
  readonly carrier: TargetTypeRef;
}
