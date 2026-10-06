import type { RustProviderOperationRow, RustProviderTypeRow } from "../../../providers/packages/model.js";
import type { RustSourcePolicyContext } from "../../model/context.js";
import type { RustSourceProfileRegistry } from "../source-profile.js";
import type { RustSourceTypeRegistry } from "../source-type-registry.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { SourceStorageProjection } from "@tsonic/target-api/analysis";
import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export interface RustTargetTypeResolutionOptions {
  readonly jsEnabled: boolean;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly RustProviderTypeRow[];
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly sourceErrorCarrier: (subject: Node | undefined, projection?: readonly SourceStorageProjection[]) => TargetTypeRef | undefined;
  readonly projectCarrierSupportsObjectIdentity: (carrier: TargetTypeRef) => boolean;
  readonly resolveProjectUnionCarrier: (
    memberCarriers: readonly TargetTypeRef[],
  ) => TargetTypeRef | undefined;
}

export interface RustTargetTypeResolutionContext extends RustSourcePolicyContext {
  readonly sourceStorageSubject?: Node;
  readonly sourceStorageProjection?: readonly SourceStorageProjection[];
  readonly currentSourceFile: SourceFile;
  readonly currentSemantics: SourceFileSemantics;
  readonly sourceTypeParameterSubstitutions?: ReadonlyMap<Node, RustSourceTypeArgument>;
}

export interface RustSourceTypeArgument {
  readonly sourceType: Type;
  readonly carrier: TargetTypeRef;
}
