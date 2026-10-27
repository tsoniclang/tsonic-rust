import type { Node } from "@tsonic/tsts";
import type { RustRawAddressPlan } from "../../../../target-model/records/storage/raw-addresses.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { createRustRecordFamily } from "../family.js";

export interface RustRawAddressProducer {
  readonly records: RustRecordFamily<RustRawAddressPlan>;
  identity(subject: Node, method: "same" | "hash", resultCarrier: TargetTypeRef,
    arguments_: RustRawAddressPlan["arguments"]): void;
  address(subject: Node, method: "address" | "from_address" | "offset" | "offset_unsigned", width: 32 | 64,
    resultCarrier: TargetTypeRef, arguments_: RustRawAddressPlan["arguments"]): void;
}

export function createRustRawAddressProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustRawAddressPlan>,
): RustRawAddressProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.rawAddressPlan", equals: (
    left: RustRawAddressPlan, right: RustRawAddressPlan,
  ) => left.method === right.method && ("width" in left ? "width" in right && left.width === right.width : !("width" in right)) &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) && left.arguments.length === right.arguments.length &&
    left.arguments.every((argument, index) => {
      const other = right.arguments[index];
      return other !== undefined && argument.expression === other.expression && argument.input === other.input && argument.cast === other.cast &&
        rustTargetTypeRefEquals(argument.carrier, other.carrier);
    }) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    identity(subject: Node, method: "same" | "hash", resultCarrier: TargetTypeRef,
      arguments_: RustRawAddressPlan["arguments"]): void {
      family.writer.set(subject, Object.freeze({ method, resultCarrier, arguments: Object.freeze(arguments_) }));
    },
    address(subject: Node, method: "address" | "from_address" | "offset" | "offset_unsigned", width: 32 | 64,
      resultCarrier: TargetTypeRef, arguments_: RustRawAddressPlan["arguments"]): void {
      family.writer.set(subject, Object.freeze({ method, width, resultCarrier, arguments: Object.freeze(arguments_) }));
    },
  });
}
