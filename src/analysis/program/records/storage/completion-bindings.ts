import type { Node } from "@tsonic/tsts";
import type { RustCompletionBinding } from "../../../../target-model/records/storage/completion-bindings.js";
import { createRustRecordFamily } from "../family.js";

export function createRustCompletionBindingProducer(assertOpen: () => void) {
  const bindings = createRustRecordFamily<readonly RustCompletionBinding[]>({ id: "tsonic.rust.completionBindings", equals: (left, right) => left === right }, assertOpen);
  const owners = createRustRecordFamily<Node>({ id: "tsonic.rust.completionBindingOwner", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ completionBindings: bindings.reader, completionBindingOwner: owners.reader }),
    publish(regions: ReadonlyMap<Node, readonly RustCompletionBinding[]>, lexicalOwners: ReadonlyMap<Node, Node>): void {
      for (const [node, values] of regions) bindings.writer.set(node, Object.freeze(values));
      for (const [declaration, owner] of lexicalOwners) owners.writer.set(declaration, owner);
    } });
}

export type RustCompletionBindingProducer = ReturnType<typeof createRustCompletionBindingProducer>;
