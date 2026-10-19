import type { Node } from "@tsonic/tsts";
import type { RustMethodDeclarationEmission, RustMethodEmissionRecords } from "../../../target-model/records/method-emission.js";
import { createRustRecordFamily } from "./family.js";

export interface RustMethodEmissionProducer {
  readonly records: RustMethodEmissionRecords;
  method(subject: Node, value: RustMethodDeclarationEmission): void;
  classDeclaration(subject: Node, value: readonly Node[]): void;
}

export function createRustMethodEmissionProducer(assertOpen: () => void): RustMethodEmissionProducer {
  const methods = createRustRecordFamily<RustMethodDeclarationEmission>({ id: "tsonic.rust.methodDeclaration", equals: (left, right) => left === right }, assertOpen);
  const classes = createRustRecordFamily<readonly Node[]>({ id: "tsonic.rust.classMethods", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ methodDeclaration: methods.reader, classMethods: classes.reader }),
    method: (subject: Node, value: RustMethodDeclarationEmission): void => methods.writer.set(subject, Object.freeze(value)),
    classDeclaration: (subject: Node, value: readonly Node[]): void => classes.writer.set(subject, Object.freeze(value)),
  });
}
