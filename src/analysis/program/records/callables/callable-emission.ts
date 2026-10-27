import type { Node } from "@tsonic/tsts";
import type { RustCallableDeclarationEmission } from "../../../../target-model/records/callables/callable-emission.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustCallableDeclarationProducer {
  readonly records: RustRecordFamily<RustCallableDeclarationEmission>;
  declaration(subject: Node, value: RustCallableDeclarationEmission): void;
}

export function createRustCallableDeclarationProducer(assertOpen: () => void): RustCallableDeclarationProducer {
  const family = createRustRecordFamily<RustCallableDeclarationEmission>({ id: "tsonic.rust.callableDeclaration", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    declaration: (subject: Node, value: RustCallableDeclarationEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
