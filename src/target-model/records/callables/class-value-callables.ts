import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "./callable-adapters.js";

export interface RustClassValueCallable {
  readonly declaration: Node;
  readonly ownerCarrier: TargetTypeRef;
  readonly targetName: string;
  readonly parameters: readonly RustCallableParameterAbi[];
  readonly parameterAdapters: readonly RustCallableParameterAdapter[];
  readonly resultAdapter: RustCallableValueAdapter;
  readonly carrier: TargetTypeRef;
}

export interface RustClassValueForwarderEmission {
  readonly environmentArgument: boolean;
  readonly moduleFunction: { readonly fileName: string; readonly name: string } | undefined;
}

export interface RustClassValueForwarderRecords {
  readonly classValueForwarder: { readonly get: (callable: RustClassValueCallable, construction: boolean) => RustClassValueForwarderEmission | undefined };
}
