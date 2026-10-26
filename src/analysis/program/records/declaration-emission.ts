import type { Node } from "@tsonic/tsts";
import type { RustDeclarationEmissionRecords, RustClassDeclarationEmission, RustCallableReturnEmission, RustCallableLeadingEmission } from "../../../target-model/records/declaration-emission.js";
import { createRustRecordFamily } from "./family.js";

export interface RustDeclarationEmissionProducer {
  readonly records: RustDeclarationEmissionRecords;
  classDeclaration(subject: Node, value: RustClassDeclarationEmission): void;
  callable(subject: Node, value: RustCallableReturnEmission): void;
  leading(subject: Node, value: RustCallableLeadingEmission): void;
  sourceFile(subject: Node, value: readonly string[]): void;
}

export function createRustDeclarationEmissionProducer(assertOpen: () => void): RustDeclarationEmissionProducer {
  const classes = createRustRecordFamily<RustClassDeclarationEmission>({ id: "tsonic.rust.classDeclaration", equals: (left, right) => left === right }, assertOpen);
  const returns = createRustRecordFamily<RustCallableReturnEmission>({ id: "tsonic.rust.callableReturn", equals: (left, right) => left === right }, assertOpen);
  const leading = createRustRecordFamily<RustCallableLeadingEmission>({ id: "tsonic.rust.callableLeading", equals: (left, right) => left === right }, assertOpen);
  const scopes = createRustRecordFamily<readonly string[]>({ id: "tsonic.rust.sourceTypeScopes", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ classDeclaration: classes.reader, callableReturn: returns.reader, callableLeading: leading.reader, sourceTypeScopes: scopes.reader }),
    classDeclaration: (subject: Node, value: RustClassDeclarationEmission): void => classes.writer.set(subject, Object.freeze(value)),
    callable: (subject: Node, value: RustCallableReturnEmission): void => returns.writer.set(subject, Object.freeze(value)),
    leading: (subject: Node, value: RustCallableLeadingEmission): void => leading.writer.set(subject, Object.freeze(value)),
    sourceFile: (subject: Node, value: readonly string[]): void => scopes.writer.set(subject, Object.freeze(value)),
  });
}
