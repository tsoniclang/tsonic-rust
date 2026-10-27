import type { Node } from "@tsonic/tsts";
import type { RustNativeParticipation } from "../../../../target-model/records/native/native-demand.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeParticipationProducer {
  readonly records: RustRecordFamily<RustNativeParticipation>;
  selected(declaration: Node, participation: RustNativeParticipation): void;
}

export function createRustNativeParticipationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustNativeParticipation>,
): RustNativeParticipationProducer {
  const family = createRustRecordFamily<RustNativeParticipation>({ id: "tsonic.rust.nativeParticipation",
    equals: (left, right) => left === right }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    selected(declaration: Node, participation: RustNativeParticipation): void {
      assertOpen();
      family.writer.set(declaration, participation);
    },
  });
}
