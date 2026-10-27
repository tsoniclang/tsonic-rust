import type { RustCallableParameterAdapter, RustCallableValueAdapter } from "../../target-model/records/callables/callable-adapters.js";

export function rustCallableAdapterValues(callable: {
  readonly resultAdapter: RustCallableValueAdapter;
  readonly parameterAdapters: readonly RustCallableParameterAdapter[];
}): readonly RustCallableValueAdapter[] {
  return [callable.resultAdapter, ...callable.parameterAdapters.flatMap((parameter): readonly RustCallableValueAdapter[] => {
    switch (parameter.kind) {
      case "runtime-value":
      case "logical-value":
        return [parameter.adapter];
      case "rest-element": return parameter.optionalAdapter === undefined ? [parameter.adapter] : [parameter.adapter, parameter.optionalAdapter];
      case "rest": return parameter.segments.map(segment => segment.adapter);
      case "omitted": return [];
    }
  })];
}
