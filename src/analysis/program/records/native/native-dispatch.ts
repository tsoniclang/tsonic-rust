import type { RustNativeCallableProtocol } from "../../../../target-model/records/native/native-protocols.js";
import type { RustNativeCallableDispatchPlan } from "../../../../target-model/records/native/native-dispatch.js";

export function sealRustNativeCallableDispatch(required: ReadonlyMap<RustNativeCallableProtocol, boolean>): RustNativeCallableDispatchPlan {
  const selected = new Map(required);
  return Object.freeze({ requiredFor: (protocol: RustNativeCallableProtocol) => selected.get(protocol) ?? true });
}
