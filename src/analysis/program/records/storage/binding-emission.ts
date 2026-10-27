import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustBindingProjectionEmission } from "../../../../target-model/records/storage/binding-emission.js";
import { createRustRecordFamily } from "../family.js";

export interface RustBindingEmissionProducer {
  readonly records: RustRecordFamily<RustBindingProjectionEmission>;
  projection(subject: Node, value: RustBindingProjectionEmission): void;
}

export function createRustBindingEmissionProducer(assertOpen: () => void): RustBindingEmissionProducer {
  const values = createRustRecordFamily<RustBindingProjectionEmission>({ id: "tsonic.rust.bindingProjectionEmission", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: values.reader,
    projection: (subject: Node, value: RustBindingProjectionEmission): void => values.writer.set(subject, Object.freeze(value)) });
}
