import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { createRustRecordFamily } from "../family.js";

type RustIndexedFieldKeyArgument = Exclude<ReturnType<RustProgramRecords["indexedFieldKeyArgument"]["get"]>, undefined>;

export interface RustIndexedFieldKeyArgumentProducer {
  readonly records: RustProgramRecords["indexedFieldKeyArgument"];
  selected(argument: Node, carrier: TargetTypeRef, evaluate: boolean): void;
}

export function createRustIndexedFieldKeyArgumentProducer(
  assertOpen: () => void,
  inherited?: RustProgramRecords["indexedFieldKeyArgument"],
): RustIndexedFieldKeyArgumentProducer {
  const family = createRustRecordFamily<RustIndexedFieldKeyArgument>({
    id: "tsonic.rust.indexedFieldKeyArgument", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    selected(argument: Node, carrier: TargetTypeRef, evaluate: boolean): void {
      family.writer.set(argument, { carrier, evaluate });
    },
  });
}
