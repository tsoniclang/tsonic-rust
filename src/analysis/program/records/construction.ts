import type { Node } from "@tsonic/tsts";
import type { RustAdmittedConstruction } from "../../../target-model/records/construction.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustConstructionProducer {
  readonly records: RustRecordFamily<RustAdmittedConstruction>;
  classDeclaration(subject: Node, value: RustAdmittedConstruction): void;
}

export function createRustConstructionProducer(assertOpen: () => void): RustConstructionProducer {
  const family = createRustRecordFamily<RustAdmittedConstruction>({ id: "tsonic.rust.classConstruction", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    classDeclaration: (subject: Node, value: RustAdmittedConstruction): void => family.writer.set(subject, Object.freeze(value)),
  });
}
