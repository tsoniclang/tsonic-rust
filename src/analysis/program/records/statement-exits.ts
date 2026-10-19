import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustStatementExitProducer {
  readonly records: RustRecordFamily<boolean>;
  statement(subject: Node, exits: boolean): void;
}

export function createRustStatementExitProducer(
  assertOpen: () => void,
): RustStatementExitProducer {
  const family = createRustRecordFamily<boolean>({
    id: "tsonic.rust.statementExit", equals: (left, right) => left === right,
  }, assertOpen);
  return Object.freeze({ records: family.reader,
    statement(subject: Node, exits: boolean): void {
      family.writer.set(subject, exits);
    },
  });
}
