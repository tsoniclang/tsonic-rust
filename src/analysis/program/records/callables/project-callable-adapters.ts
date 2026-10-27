import { requireRustRecord } from "../objects/required-records.js";
import type { RustProjectCallableAdapter } from "../../../../target-model/records/callables/project-callable-adapters.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { selectRustProjectCallableAdapters } from "../../../project-types/callable-adapters.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";

export interface RustProjectCallableAdapterProducer {
  readonly records: RustRecordFamily<readonly RustProjectCallableAdapter[]>;
  finalize(walk: RustFactWalk): void;
}

export function createRustProjectCallableAdapterProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<readonly RustProjectCallableAdapter[]>,
): RustProjectCallableAdapterProducer {
  const family = createRustRecordFamily<readonly RustProjectCallableAdapter[]>({ id: "tsonic.rust.projectCallableAdapters",
    equals: (left, right) => left.length === right.length &&
      left.every((entry, index) => {
        const candidate = right[index];
        if (candidate === undefined || entry.contract !== candidate.contract || entry.implementation !== candidate.implementation) return false;
        const { contract: _leftContract, implementation: _leftImplementation, ...leftData } = entry;
        const { contract: _rightContract, implementation: _rightImplementation, ...rightData } = candidate;
        return closedMetadataEquals(leftData, rightData);
      }) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(walk: RustFactWalk): void {
      assertOpen();
      for (const concrete of walk.context.projectTypes.definitions) {
        const adapters = selectRustProjectCallableAdapters(walk, concrete);
        if (adapters !== undefined) {
          requireRustRecord(walk.context.requiredRecords, "projectCallableAdapters", concrete.declaration,
            "project-callable", "projectCallableAdapterPlans.finalize");
          family.writer.set(concrete.declaration, adapters);
        }
      }
    },
  });
}
