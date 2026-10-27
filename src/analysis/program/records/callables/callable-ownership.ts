import type { Node } from "@tsonic/tsts";
import type { RustCallableOwnershipComponent, RustCallableOwnershipComponentPublication, RustCallableOwnershipComponentQueries } from "../../../../target-model/records/callables/callable-ownership.js";

export function sealRustCallableOwnershipComponents(input: RustCallableOwnershipComponentPublication): RustCallableOwnershipComponentQueries {
  const admitted = input.failure === undefined;
  const callableComponents = admitted ? input.callableComponents : new Map<Node, RustCallableOwnershipComponent>();
  const slotComponents = admitted ? input.slotComponents : new Map<Node, RustCallableOwnershipComponent>();
  const cyclicCallables = admitted ? input.cyclicCallables : new Set<Node>();
  const cyclicSlots = admitted ? input.cyclicSlots : new Set<Node>();
  const independentCallables = admitted ? input.independentCallables : new Set<Node>();
  const receiverOwners = admitted ? input.receiverOwners : new Map<Node, Node>();
  return Object.freeze({ components: Object.freeze(admitted ? [...input.components] : []),
    issues: Object.freeze([...input.issues]), failureReason: () => input.failure,
    componentForCallable: (declaration: Node) => callableComponents.get(declaration),
    componentForSlot: (declaration: Node) => slotComponents.get(input.canonicalSlots.get(declaration) ?? declaration),
    isCyclicCallable: (declaration: Node) => cyclicCallables.has(declaration),
    isCyclicSlot: (declaration: Node) => cyclicSlots.has(input.canonicalSlots.get(declaration) ?? declaration),
    isIndependentCallable: (declaration: Node) => independentCallables.has(declaration),
    instanceReceiverOwner: (receiver: Node) => receiverOwners.get(receiver),
  });
}
