import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableProtocol } from "../../../../target-model/records/native/native-protocols.js";
import type { RustNativeGenericProducerBinding, RustNativeGenericProducerForwarding, RustNativeGenericProducerPlan, RustNativeGenericProducerPublication } from "../../../../target-model/records/native/native-generic-producers.js";

const emptyBindings: readonly RustNativeGenericProducerBinding[] = Object.freeze([]);
const emptyForwarding: readonly RustNativeGenericProducerForwarding[] = Object.freeze([]);
const emptyArities: readonly number[] = Object.freeze([]);

export function sealRustNativeGenericProducers(input: RustNativeGenericProducerPublication): RustNativeGenericProducerPlan {
  return Object.freeze({
    bindings: Object.freeze([...input.bindingsByProtocol.values()].flat()),
    open: input.open,
    unresolved: Object.freeze([...input.unresolved]),
    forProtocol: (protocol: RustNativeCallableProtocol) => input.bindingsByProtocol.get(protocol) ?? emptyBindings,
    forwardingFor: (owner: Node) => input.forwarding.get(owner) ?? emptyForwarding,
    errorAritiesFor: (file: string) => input.errorArities.has(file) ? input.errorArities.get(file) : emptyArities,
  });
}
