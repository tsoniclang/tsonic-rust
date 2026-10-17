import type { RustCallableParameterAdapter } from "../../target-model/records/callable-adapters.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";
import { isRustCopyCarrier, isRustStringCarrier } from "../../target-model/types/index.js";

export function rustCallableParameterCloneSources(adapters: readonly RustCallableParameterAdapter[]): readonly TargetTypeRef[] {
  return adapters.flatMap(adapter => {
    if (adapter.kind === "runtime-value" || adapter.kind === "logical-value") {
      return adapter.source.mode !== "value" && !isRustCopyCarrier(adapter.source.valueCarrier) &&
        !isRustStringCarrier(adapter.source.valueCarrier) ? [adapter.source.valueCarrier] : [];
    }
    const sources = adapter.kind === "rest-element" ? [adapter.source]
      : adapter.kind === "rest" ? adapter.segments.flatMap(segment => segment.kind === "sequence" ? [segment.source] : []) : [];
    return sources.flatMap(source => {
      const sequence = rustRestSequenceElements(source.parameterCarrier);
      return sequence?.collection === "js-array" ? sequence.elements : [];
    });
  });
}
