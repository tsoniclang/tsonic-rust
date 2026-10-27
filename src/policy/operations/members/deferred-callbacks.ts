import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";
import type { RustErrorEffectsFact } from "../../../target-model/records/errors/error-effects.js";
import type { Node } from "@tsonic/tsts";

import type { RustPreparedDeferredCheckedCall } from "../../../target-model/records/callables/deferred-callbacks.js";
export interface RustPreparedCallbackEffects {
  readonly invocationOwner: Node;
  readonly invocationEffects: RustErrorEffectsFact;
  readonly implementationEffects: RustErrorEffectsFact;
}

export function callbackFallibleTemplate(
  prepared: RustPreparedDeferredCheckedCall,
  effects: Pick<RustPreparedCallbackEffects, "invocationEffects">,
): RustProviderOperationTemplate {
  const failure = prepared.callback.failure;
  const callbackFallible = effects.invocationEffects.localErrors || effects.invocationEffects.nativeErrors.length !== 0;
  if (failure.kind === "returned-future" || !callbackFallible) {
    return prepared.template;
  }
  const { errorCarrier: _providerErrorCarrier, ...template } = prepared.template;
  return {
    ...template,
    target: callbackFallible ? failure.fallibleTarget : template.target,
    isFallible: true,
    errorBoundary: failure.resultError.kind === "native" ? "provider-native" : "source-program",
    ...(failure.resultError.kind === "native" ? { errorCarrier: failure.resultError.carrier } : {}),
  };
}
