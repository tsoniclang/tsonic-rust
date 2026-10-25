import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import type { RustErrorEffectsFact } from "../../../target-model/records/error-effects.js";
import type { Node } from "@tsonic/tsts";

import type { RustPreparedDeferredCheckedCall } from "../../../target-model/records/deferred-callbacks.js";
export interface RustPreparedCallbackEffects {
  readonly invocationOwner: Node;
  readonly invocationEffects: RustErrorEffectsFact;
  readonly implementationEffects: RustErrorEffectsFact;
}

export function callbackFallibleTemplate(
  prepared: RustPreparedDeferredCheckedCall,
  effects: RustPreparedCallbackEffects,
): RustProviderOperationTemplate {
  if (prepared.callback.failure.kind === "returned-future" ||
    !effects.invocationEffects.localErrors && effects.invocationEffects.nativeErrors.length === 0) {
    return prepared.template;
  }
  const { errorCarrier: _providerErrorCarrier, ...template } = prepared.template;
  return {
    ...template,
    target: prepared.callback.failure.fallibleTarget,
    isFallible: true,
    errorBoundary: "source-program",
  };
}
