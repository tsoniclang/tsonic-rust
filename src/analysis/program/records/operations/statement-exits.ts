import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustLoopForm } from "../../../../target-model/records/operations/statement-exits.js";
import { createRustRecordFamily } from "../family.js";

export interface RustStatementExitProducer {
  readonly modules: RustRecordFamily<boolean>;
  module(subject: Node, fallsThrough: boolean): void;
  readonly records: RustRecordFamily<boolean>;
  readonly forms: RustRecordFamily<RustLoopForm>;
  statement(subject: Node, exits: boolean): void;
  loop(subject: Node, form: RustLoopForm): void;
}

export function createRustStatementExitProducer(
  assertOpen: () => void,
): RustStatementExitProducer {
  const family = createRustRecordFamily<boolean>({
    id: "tsonic.rust.statementExit", equals: (left, right) => left === right,
  }, assertOpen);
  const forms = createRustRecordFamily<RustLoopForm>({
    id: "tsonic.rust.loopForm", equals: (left, right) => left.kind === right.kind && left.neverFallsThrough === right.neverFallsThrough,
  }, assertOpen);
  const modules = createRustRecordFamily<boolean>({ id: "tsonic.rust.moduleFallthrough", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader, forms: forms.reader, modules: modules.reader,
    module: (subject: Node, fallsThrough: boolean): void => modules.writer.set(subject, fallsThrough),
    statement(subject: Node, exits: boolean): void {
      family.writer.set(subject, exits);
    },
    loop(subject: Node, form: RustLoopForm): void {
      forms.writer.set(subject, Object.freeze(form));
    },
  });
}
