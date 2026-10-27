import type { Node } from "@tsonic/tsts";
import type { RustLexicalValueDeclaration } from "../../../../target-model/records/storage/lexical-values.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustLexicalValueProducer {
  readonly records: RustRecordFamily<readonly RustLexicalValueDeclaration[]>;
  statement(subject: Node, values: readonly RustLexicalValueDeclaration[]): void;
}

export function createRustLexicalValueProducer(assertOpen: () => void): RustLexicalValueProducer {
  const family = createRustRecordFamily<readonly RustLexicalValueDeclaration[]>({ id: "tsonic.rust.lexicalValues", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    statement: (subject: Node, values: readonly RustLexicalValueDeclaration[]): void => family.writer.set(subject, Object.freeze(values)),
  });
}
