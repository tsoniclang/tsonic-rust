import type { RustCallableParameterAdapter, RustCallableValueAdapter } from "../facts/callable-adapters.js";

export function rustCallableAdapterValues(callable: {
  readonly resultAdapter: RustCallableValueAdapter;
  readonly parameterAdapters: readonly RustCallableParameterAdapter[];
}): readonly RustCallableValueAdapter[] {
  return [callable.resultAdapter, ...callable.parameterAdapters.flatMap((parameter): readonly RustCallableValueAdapter[] => {
    switch (parameter.kind) {
      case "runtime-value":
      case "logical-value":
      case "rest-element": return [parameter.adapter];
      case "rest": return parameter.segments.map(segment => segment.adapter);
      case "omitted": return [];
    }
  })];
}
