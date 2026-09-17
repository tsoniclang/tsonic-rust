import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustPlanKey } from "../../target-model/facts/keys.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
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

export const rustProjectCallableAdaptersKey: RustPlanKey<readonly RustProjectCallableAdapter[]> =
  defineRustPlanKey("projectCallableAdapters", (left, right) =>
    left.length === right.length && left.every((entry, index) => {
      const candidate = right[index];
      if (candidate === undefined || entry.contract !== candidate.contract ||
        entry.implementation !== candidate.implementation) return false;
      const { contract: _leftContract, implementation: _leftImplementation, ...leftData } = entry;
      const { contract: _rightContract, implementation: _rightImplementation, ...rightData } = candidate;
      return closedMetadataEquals(leftData, rightData);
    }));
