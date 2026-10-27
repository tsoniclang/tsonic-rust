import type { Node } from "@tsonic/tsts";
import { rustNativeMemoryLayoutsEqual, type RustNativeMemoryLayout } from "../../../../target-model/operations/native-memory.js";
import type { RustRawLocationPlan } from "../../../../target-model/records/native/native-memory.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustRawLocationProducer {
  readonly records: RustRecordFamily<RustRawLocationPlan>;
  conversion(subject: Node, operation: RustRawLocationPlan["operation"], expression: Node,
    inputCarrier: TargetTypeRef, layout: RustNativeMemoryLayout, optionalInput: boolean): void;
}

export function createRustRawLocationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustRawLocationPlan>,
): RustRawLocationProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.rawLocation", equals: (
    left: RustRawLocationPlan, right: RustRawLocationPlan,
  ) => left.operation === right.operation && left.expression === right.expression && left.optionalInput === right.optionalInput &&
    rustTargetTypeRefEquals(left.inputCarrier, right.inputCarrier) && rustNativeMemoryLayoutsEqual(left.layout, right.layout) },
  assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    conversion(subject: Node, operation: RustRawLocationPlan["operation"], expression: Node,
      inputCarrier: TargetTypeRef, layout: RustNativeMemoryLayout, optionalInput: boolean): void {
      family.writer.set(subject, Object.freeze({ operation, expression, inputCarrier, layout, optionalInput }));
    },
  });
}
