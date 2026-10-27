import { requireRustRecord } from "./required-records.js";
import type { Node } from "@tsonic/tsts";
import type { RustClassValueFact } from "../../../../target-model/records/objects/class-values.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectRustClassValue } from "../../../objects/class-values.js";
import { setCarrierFact } from "../../../operations/project-calls.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";

export interface RustClassValueProducer {
  readonly records: RustRecordFamily<RustClassValueFact>;
  resolve(walk: RustFactWalk, expression: Node, expected: TargetTypeRef | undefined): TargetTypeRef | undefined;
}

export function createRustClassValueProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustClassValueFact>,
): RustClassValueProducer {
  const family = createRustRecordFamily<RustClassValueFact>({ id: "tsonic.rust.classValue", equals: (left, right) =>
    left.declaration === right.declaration && rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    resolve(walk: RustFactWalk, expression: Node, expected: TargetTypeRef | undefined): TargetTypeRef | undefined {
      assertOpen();
      const existing = family.reader.get(expression);
      if (existing !== undefined) return existing.carrier;
      const selection = selectRustClassValue(walk, expression, expected);
      if (selection === undefined) return undefined;
      if (selection.kind === "constructor") {
        requireRustRecord(walk.context.requiredRecords, "classValue", expression, "constructor", "classValues.resolve");
        family.writer.set(expression, selection.value);
      }
      return setCarrierFact(walk, expression, selection.kind === "constructor" ? selection.value.carrier : selection.carrier);
    },
  });
}
