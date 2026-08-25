import type { RustProviderOperationRow, RustProviderTypeRow } from "../../../providers/packages/model.js";
import type { RustSourcePolicyContext } from "../../model/context.js";
import type { RustSourceProfileRegistry } from "../source-profile.js";
import type { RustSourceTypeRegistry } from "../source-type-registry.js";
import type { RustSourceGenericIndex } from "../source-generics.js";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { SourceFile } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export interface RustTargetTypeResolutionOptions {
  readonly jsEnabled: boolean;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly RustProviderTypeRow[];
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly resolveProjectUnionCarrier: (
    memberCarriers: readonly TargetTypeRef[],
  ) => TargetTypeRef | undefined;
}

export interface RustTargetTypeResolutionContext extends RustSourcePolicyContext {
  readonly currentSourceFile: SourceFile;
  readonly currentSemantics: SourceFileSemantics;
  readonly sourceGenerics: RustSourceGenericIndex;
}
