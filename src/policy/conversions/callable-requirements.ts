import type { RustCallableParameterAdapter } from "../../target-model/records/callables/callable-adapters.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustCallableRestCloneSources(adapters: readonly RustCallableParameterAdapter[]): readonly TargetTypeRef[] {
  return adapters.flatMap(adapter => {
    const iterations = adapter.kind === "rest-element" ? [adapter.iteration]
      : adapter.kind === "rest" ? adapter.segments.flatMap(segment => segment.kind === "sequence" ? [segment.iteration] : []) : [];
    return iterations.flatMap(iteration => iteration.collection === "js-array" ? [iteration.elementCarrier] : []);
  });
}
