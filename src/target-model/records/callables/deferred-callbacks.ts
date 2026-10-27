import type { ProviderDeclarationIdentity } from "@tsonic/tsts";

import type { RustProviderOperationTemplate } from "../../operations/model.js";

import type { TargetTypeRef } from "../../types/model.js";
import type { RustRegExpReplacementCallbackContract } from "./regexp-callbacks.js";

export interface RustPreparedDeferredCheckedCall {
  readonly sourceName: string;
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly callback: import("../../operations/model.js").RustCallbackOperationTemplate;
  readonly template: RustProviderOperationTemplate;
  readonly parameterCarriers: readonly TargetTypeRef[];
  readonly resultCarrier: TargetTypeRef;
  readonly replacementCallback?: RustRegExpReplacementCallbackContract;
}
