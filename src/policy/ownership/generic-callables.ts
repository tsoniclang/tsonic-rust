import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericCallableImplementation } from "../../target-model/records/generic-callables.js";
import { rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";

export function selectRustGenericCallableStorage(input: {
  readonly identityObserved: boolean;
  readonly creation: RustGenericCallableImplementation["creation"];
  readonly asynchronous: boolean;
  readonly generator: boolean;
  readonly result: TargetTypeRef;
  readonly captures: RustGenericCallableImplementation["captures"];
  readonly receiverFields: RustGenericCallableImplementation["receiverFields"];
  readonly receivers: RustGenericCallableImplementation["receivers"];
}): RustGenericCallableImplementation["storage"] {
  return (!input.identityObserved || input.creation === "declaration") &&
    (!input.asynchronous || rustNativeFutureCallableResult(input.result) !== undefined ||
      input.captures.length === 0 && input.receiverFields.length === 0 && input.receivers.length === 0) &&
    !input.generator && input.receiverFields.length === 0 && input.receivers.length === 0 &&
    input.captures.every(capture => capture.storage === "value" && isRustCopyCarrier(capture.storageCarrier))
      ? "value" : "shared";
}
