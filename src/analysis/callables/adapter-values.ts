import type { RustCallableParameterAdapter, RustCallableValueAdapter } from "../facts/callable-adapters.js";

export function rustCallableAdapterValues(callable: {
  readonly resultAdapter: RustCallableValueAdapter;
  readonly parameterAdapters: readonly RustCallableParameterAdapter[];
}): readonly RustCallableValueAdapter[] {
  return [callable.resultAdapter, ...callable.parameterAdapters.flatMap((parameter): readonly RustCallableValueAdapter[] => {
    switch (parameter.kind) {
      case "runtime-value":
      case "logical-value": return [parameter.adapter];
      case "sequence-rest": return [parameter.elementAdapter];
      case "fixed-rest": return parameter.elementAdapters;
      case "omitted": return [];
    }
  })];
}
