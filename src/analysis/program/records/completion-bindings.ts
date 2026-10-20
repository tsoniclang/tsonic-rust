import type { Node } from "@tsonic/tsts";
import type { RustCompletionBinding } from "../../../target-model/records/completion-bindings.js";
import { createRustRecordFamily } from "./family.js";

export function createRustCompletionBindingProducer(assertOpen: () => void) {
  const bindings = createRustRecordFamily<readonly RustCompletionBinding[]>({ id: "tsonic.rust.completionBindings", equals: (left, right) => left === right }, assertOpen);
  const owners = createRustRecordFamily<Node>({ id: "tsonic.rust.completionBindingOwner", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ completionBindings: bindings.reader, completionBindingOwner: owners.reader }),
    publish(node: Node, values: readonly RustCompletionBinding[]): void {
      bindings.writer.set(node, Object.freeze(values));
      for (const value of values) owners.writer.set(value.declaration, node);
    } });
}

export type RustCompletionBindingProducer = ReturnType<typeof createRustCompletionBindingProducer>;
