import type { RustProviderOperationRow, RustProviderTypeRow } from "../../../../target-model/identities/provider-relations.js";
import type { RustSourcePolicyContext } from "../../../../policy/model/context.js";
import type { RustSourceProfileRegistry } from "../../../../policy/types/model/source-profile.js";
import type { RustSourceTypeRegistry } from "../../../project-types/source-type-model.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { Node, SourceFile, Type, TypePropertyInfo } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustSourceTypeFamilyImplementation } from "../../../../target-model/types/type-families.js";
import type { RustTargetGenericBindings } from "../../../../target-model/types/carriers/generic-inference.js";

export interface RustClassFrameInstantiation {
  readonly instance: TargetTypeRef;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly bindings: RustTargetGenericBindings;
}

export interface RustTargetTypeResolutionOptions {
  readonly jsEnabled: boolean;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly RustProviderTypeRow[];
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly sourceErrorCarrier: (subject: SourceStorageSubject | undefined) => TargetTypeRef | undefined;
  readonly callableSignatureCarrier: (declaration: Node) => TargetTypeRef | undefined;
  readonly callableParameterCarriers: (declaration: Node) => readonly TargetTypeRef[] | undefined;
  readonly callableStorageCarrier: (
    subject: SourceStorageSubject,
    logicalCarrier: TargetTypeRef,
    environmentFor: (declaration: Node, excludedCaptures: ReadonlySet<Node>) => readonly TargetTypeRef[] | undefined,
    classFrameFor: (declaration: Node) => RustClassFrameInstantiation | undefined,
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
  readonly sourceUnionInstantiationPath?: readonly {
    readonly sourceType: Type;
    readonly carrier: TargetTypeRef;
  }[];
}

export interface RustSourceTypeArgument {
  readonly sourceType: Type;
  readonly carrier: TargetTypeRef;
}
