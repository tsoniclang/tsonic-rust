import type { Node } from "@tsonic/tsts";
import type { RustDeclarationEmissionRecords, RustClassDeclarationEmission, RustCallableReturnEmission } from "../../../target-model/records/declaration-emission.js";
import { createRustRecordFamily } from "./family.js";

export interface RustDeclarationEmissionProducer {
  readonly records: RustDeclarationEmissionRecords;
  classDeclaration(subject: Node, value: RustClassDeclarationEmission): void;
  callable(subject: Node, value: RustCallableReturnEmission): void;
}

export function createRustDeclarationEmissionProducer(assertOpen: () => void): RustDeclarationEmissionProducer {
  const classes = createRustRecordFamily<RustClassDeclarationEmission>({ id: "tsonic.rust.classDeclaration", equals: (left, right) => left === right }, assertOpen);
  const returns = createRustRecordFamily<RustCallableReturnEmission>({ id: "tsonic.rust.callableReturn", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ classDeclaration: classes.reader, callableReturn: returns.reader }),
    classDeclaration: (subject: Node, value: RustClassDeclarationEmission): void => classes.writer.set(subject, Object.freeze(value)),
    callable: (subject: Node, value: RustCallableReturnEmission): void => returns.writer.set(subject, Object.freeze(value)),
  });
}
