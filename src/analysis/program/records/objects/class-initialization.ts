import type { Node } from "@tsonic/tsts";
import type { RustClassInitializationEntry, RustStaticFieldStorageSelection } from "../../../../target-model/records/objects/class-initialization.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustClassInitializationProducer {
  readonly classes: RustRecordFamily<readonly RustClassInitializationEntry[]>;
  readonly fields: RustRecordFamily<RustStaticFieldStorageSelection>;
  classDeclaration(subject: Node, entries: readonly RustClassInitializationEntry[]): void;
  field(subject: Node, selection: RustStaticFieldStorageSelection): void;
}

export function createRustClassInitializationProducer(assertOpen: () => void): RustClassInitializationProducer {
  const classes = createRustRecordFamily<readonly RustClassInitializationEntry[]>({ id: "tsonic.rust.classInitialization", equals: (left, right) => left === right }, assertOpen);
  const fields = createRustRecordFamily<RustStaticFieldStorageSelection>({ id: "tsonic.rust.staticFieldStorage", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ classes: classes.reader, fields: fields.reader,
    classDeclaration: (subject: Node, entries: readonly RustClassInitializationEntry[]): void => classes.writer.set(subject, Object.freeze(entries)),
    field: (subject: Node, selection: RustStaticFieldStorageSelection): void => fields.writer.set(subject, Object.freeze(selection)),
  });
}
