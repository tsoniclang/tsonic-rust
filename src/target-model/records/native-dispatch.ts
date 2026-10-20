import type { RustNativeCallableProtocol } from "./native-protocols.js";

export interface RustNativeCallableDispatchPlan {
  requiredFor(protocol: RustNativeCallableProtocol): boolean;
}
