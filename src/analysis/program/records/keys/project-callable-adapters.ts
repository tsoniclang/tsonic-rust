import type { RustPlanKey } from "../key.js";
import { defineRustPlanKey } from "../key.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustProjectCallableAdapter } from "../../../../target-model/records/project-callable-adapters.js";

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
