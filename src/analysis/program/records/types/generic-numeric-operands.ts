import type { Node } from "@tsonic/tsts";
import type { RustBinaryOperatorSelection } from "../../../../target-model/operations/binary.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { createRustRecordFamily } from "../family.js";

export interface RustGenericNumericOperandsProducer {
  readonly records: RustRecordFamily<readonly TargetTypeRef[]>;
  comparison(subject: Node, left: TargetTypeRef, right: TargetTypeRef,
    selection: RustBinaryOperatorSelection | undefined): RustBinaryOperatorSelection | undefined;
}

export function createRustGenericNumericOperandsProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<readonly TargetTypeRef[]>,
): RustGenericNumericOperandsProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.genericNumericOperands", equals: (
    left: readonly TargetTypeRef[], right: readonly TargetTypeRef[],
  ) => left.length === right.length && left.every((carrier, index) =>
    rustTargetTypeRefEquals(carrier, right[index])) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    comparison(subject: Node, left: TargetTypeRef, right: TargetTypeRef,
      selection: RustBinaryOperatorSelection | undefined): RustBinaryOperatorSelection | undefined {
      assertOpen();
      if (selection !== undefined) family.writer.set(subject, Object.freeze([left, right]));
      return selection;
    },
  });
}
