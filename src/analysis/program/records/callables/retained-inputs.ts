import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableInput } from "../../../../target-model/records/native/native-protocols.js";
import type { RustRetainedCallableBoundary, RustRetainedCallableInputPlan } from "../../../../target-model/records/callables/retained-inputs.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

const absent: readonly TargetTypeRef[] = Object.freeze([]);

export function sealRustRetainedCallableInputs(requirements: ReadonlyMap<RustNativeCallableInput, ReadonlyMap<string, TargetTypeRef>>,
  boundaries: ReadonlyMap<Node, ReadonlyMap<number, RustRetainedCallableBoundary>>): RustRetainedCallableInputPlan {
  const published = new Map([...requirements].map(([selected, errors]) =>
    [selected, Object.freeze([...errors.values()])] as const));
  const selectedBoundaries = new WeakMap([...boundaries].map(([call, selected]) => [call, new Map(selected)] as const));
  return Object.freeze({
    forInput: (selected: RustNativeCallableInput) => published.get(selected) ?? absent,
    forBoundary: (call: Node, index: number) => selectedBoundaries.get(call)?.get(index),
  });
}
