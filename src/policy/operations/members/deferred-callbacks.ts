import type { RustProviderOperationTemplate } from "../../../target-model/operations/model.js";

import type { RustPreparedDeferredCheckedCall } from "../../../target-model/records/deferred-callbacks.js";
export function callbackFallibleTemplate(
  prepared: RustPreparedDeferredCheckedCall,
): RustProviderOperationTemplate {
  if (prepared.callback.failure.kind === "returned-future") {
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
