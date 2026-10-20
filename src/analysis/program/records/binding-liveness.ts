import type { Node } from "@tsonic/tsts";
import type { RustBindingLiveness } from "../../../target-model/records/binding-liveness.js";
import { createRustRecordFamily } from "./family.js";

export function createRustBindingLivenessProducer(assertOpen: () => void) {
  const bindings = createRustRecordFamily<RustBindingLiveness>({
    id: "tsonic.rust.bindingLiveness", equals: (left, right) => left === right,
  }, assertOpen);
  const writes = createRustRecordFamily<boolean>({
    id: "tsonic.rust.unobservedWrite", equals: (left, right) => left === right,
  }, assertOpen);
  return Object.freeze({ records: Object.freeze({ bindingLiveness: bindings.reader, unobservedWrite: writes.reader }),
    binding: (node: Node, value: RustBindingLiveness): void => bindings.writer.set(node, Object.freeze(value)),
    write: (node: Node, unobserved: boolean): void => writes.writer.set(node, unobserved) });
}

export type RustBindingLivenessProducer = ReturnType<typeof createRustBindingLivenessProducer>;

