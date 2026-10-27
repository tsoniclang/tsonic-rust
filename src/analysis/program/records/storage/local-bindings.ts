import type { Node } from "@tsonic/tsts";
import type { RustLocalBindingCompletion } from "../../../../target-model/records/storage/local-bindings.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustLocalBindingProducer {
  readonly records: RustRecordFamily<RustLocalBindingCompletion>;
  declaration(subject: Node, completion: RustLocalBindingCompletion): void;
}

export function createRustLocalBindingProducer(assertOpen: () => void): RustLocalBindingProducer {
  const family = createRustRecordFamily<RustLocalBindingCompletion>({ id: "tsonic.rust.localBinding",
    equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader, declaration(subject: Node, completion: RustLocalBindingCompletion): void {
    family.writer.set(subject, Object.freeze(completion));
  } });
}
