import type { Node } from "@tsonic/tsts";
import type { RustLexicalFunctionEmission } from "../../../target-model/records/lexical-functions.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustLexicalFunctionProducer {
  readonly records: RustRecordFamily<RustLexicalFunctionEmission>;
  declaration(subject: Node, value: RustLexicalFunctionEmission): void;
}

export function createRustLexicalFunctionProducer(assertOpen: () => void): RustLexicalFunctionProducer {
  const family = createRustRecordFamily<RustLexicalFunctionEmission>({ id: "tsonic.rust.lexicalFunction", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    declaration: (subject: Node, value: RustLexicalFunctionEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
