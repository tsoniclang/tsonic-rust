import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustCompileTimeSourceProducer {
  readonly records: RustRecordFamily<true>;
  erase(node: Node): void;
}

export function createRustCompileTimeSourceProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<true>,
): RustCompileTimeSourceProducer {
  const family = createRustRecordFamily<true>({
    id: "tsonic.rust.compileTimeSource", equals: (left, right) => left === right,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    erase(node: Node): void {
      assertOpen();
      if (family.reader.get(node) === undefined) family.writer.set(node, true);
    },
  });
}
