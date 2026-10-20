import type { RustGenericCallablePhysicalDefinition } from "../../../target-model/records/generic-callables.js";
import type { RustGenericCallableErrorIndex, RustGenericCallableErrorSelection } from "../../../target-model/records/generic-callable-errors.js";

export function sealRustGenericCallableErrorIndex(selections: ReadonlyMap<RustGenericCallablePhysicalDefinition, RustGenericCallableErrorSelection>): RustGenericCallableErrorIndex {
  const selected = new Map(selections);
  return Object.freeze({ forDefinition: (definition: RustGenericCallablePhysicalDefinition) => selected.get(definition) });
}

export function sealRustGenericCallableErrorSelection(selection: RustGenericCallableErrorSelection): RustGenericCallableErrorSelection {
  return Object.freeze({ effects: selection.effects, invocation: selection.invocation, awaiting: selection.awaiting,
    members: new Map(selection.members) });
}
