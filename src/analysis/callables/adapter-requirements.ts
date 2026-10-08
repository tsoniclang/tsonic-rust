import type { RustCallableParameterAdapter } from "../facts/callable-adapters.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";

export function rustCallableRestCloneSources(adapters: readonly RustCallableParameterAdapter[]): readonly TargetTypeRef[] {
  return adapters.flatMap(adapter => {
    const sources = adapter.kind === "rest-element" ? [adapter.source]
      : adapter.kind === "rest" ? adapter.segments.flatMap(segment => segment.kind === "sequence" ? [segment.source] : []) : [];
    return sources.flatMap(source => {
      const sequence = rustRestSequenceElements(source.parameterCarrier);
      return sequence?.collection === "js-array" ? sequence.elements : [];
    });
  });
}
