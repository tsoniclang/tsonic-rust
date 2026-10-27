import type { Node } from "@tsonic/tsts";
import type { RustBindingLiveness, RustUnobservedWrite } from "../../../../target-model/records/storage/binding-liveness.js";
import { createRustRecordFamily } from "../family.js";

export function createRustBindingLivenessProducer(assertOpen: () => void) {
  const bindings = createRustRecordFamily<RustBindingLiveness>({
    id: "tsonic.rust.bindingLiveness", equals: (left, right) => left === right,
  }, assertOpen);
  const writes = createRustRecordFamily<RustUnobservedWrite>({
    id: "tsonic.rust.unobservedWrite", equals: (left, right) => left === right,
  }, assertOpen);
  return Object.freeze({ records: Object.freeze({ bindingLiveness: bindings.reader, unobservedWrite: writes.reader }),
    binding: (node: Node, value: RustBindingLiveness): void => bindings.writer.set(node, Object.freeze(value)),
    write: (node: Node, value: RustUnobservedWrite): void => writes.writer.set(node, Object.freeze(value)) });
}

export type RustBindingLivenessProducer = ReturnType<typeof createRustBindingLivenessProducer>;

