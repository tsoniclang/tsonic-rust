import type { RustProviderOperationRow, RustProviderTypeRow } from "../../../../target-model/identities/provider-relations.js";
import type { RustSourcePolicyContext } from "../../../../policy/model/context.js";
import type { RustSourceProfileRegistry } from "../../../../policy/types/model/source-profile.js";
import type { RustSourceTypeRegistry } from "../../../project-types/source-type-model.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageSubject, SourceStorageUnresolved } from "@tsonic/target-api/analysis";
import type { Node, SourceFile, Type, TypePropertyInfo } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustSourceTypeFamilyImplementation } from "../../../../target-model/types/type-families.js";
import type { RustTargetGenericBindings } from "../../../../target-model/types/carriers/generic-inference.js";
import type { RustCallableOwnershipInput } from "../../../callables/ownership/ownership-plan.js";
import type { RustLifetimeRef } from "../../../../target-model/lifetimes/index.js";

export interface RustClassFrameInstantiation {
  readonly kind: "selected";
  readonly instance: TargetTypeRef;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly bindings: RustTargetGenericBindings;
}

export type RustSourceStorageResolution = SourceStorageUnresolved | {
  readonly kind: "resolved";
  readonly subject: SourceStorageSubject | undefined;
  readonly bindings: SourceStorageBindings;
};

export type RustClassFrameInstantiationSelection = RustClassFrameInstantiation |
  { readonly kind: "rejected"; readonly reason: string };

export interface RustTargetTypeResolutionOptions {
  readonly jsEnabled: boolean;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly RustProviderTypeRow[];
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly sourceErrorCarrier: (subject: SourceStorageSubject | undefined) => TargetTypeRef | undefined;
  readonly callableSignatureCarrier: (declaration: Node) => TargetTypeRef | undefined;
  readonly callableParameterCarriers: (declaration: Node) => readonly TargetTypeRef[] | undefined;
  readonly callableValueLifetime: (declaration: Node, captures: readonly TargetTypeRef[],
    role: RustSourcePolicyContext["callableRepresentation"]) => RustLifetimeRef | undefined;
  readonly callableStorageCarrier: (
    source: Pick<SourceStorageProducer, "subject" | "bindings">,
    selection: RustCallableOwnershipInput,
    logicalCarrier: TargetTypeRef,
    environmentFor: (declaration: Node, excludedCaptures: ReadonlySet<Node>) => readonly TargetTypeRef[] | undefined,
    classFrameFor: (declaration: Node) => RustClassFrameInstantiationSelection | undefined,
  ) => TargetTypeRef | undefined;
  readonly projectCarrierSupportsObjectIdentity: (carrier: TargetTypeRef) => boolean;
  readonly projectFieldProjection: (property: TypePropertyInfo, owner: TargetTypeRef, ownerType: Type,
    source: RustSourceStorageResolution | undefined) => {
    readonly output: TargetTypeRef;
    readonly field: NonNullable<RustSourceTypeFamilyImplementation["field"]>;
  } | undefined;
  readonly resolveProjectUnionCarrier: (
    memberCarriers: readonly TargetTypeRef[],
  ) => TargetTypeRef | undefined;
}

export interface RustTargetTypeResolutionContext extends RustSourcePolicyContext {
  readonly sourceStorageResolution?: RustSourceStorageResolution;
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
