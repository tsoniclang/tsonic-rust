import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "./callable-adapters.js";

export interface RustProjectCallableAdapter {
  readonly contract: Node;
  readonly implementation: Node;
  readonly slot: string;
  readonly parameters: readonly RustCallableParameterAbi[];
  readonly implementationParameters: readonly RustCallableParameterAbi[];
  readonly returnCarrier: TargetTypeRef;
  readonly implementationReturnCarrier: TargetTypeRef;
  readonly parameterAdapters: readonly RustCallableParameterAdapter[];
  readonly resultAdapter: RustCallableValueAdapter;
  readonly adapterFallible: boolean;
}
