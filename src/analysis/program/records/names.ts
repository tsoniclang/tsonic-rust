import type { Node } from "@tsonic/tsts";
import type { RustNamePlan } from "../../../target-model/names/model.js";
import { createRustRecordFamily } from "./family.js";

export function createRustSourceNameProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<string>({ id: "tsonic.rust.sourceName", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ sourceName: Object.freeze({
    get: (declaration: Node | undefined) => declaration === undefined ? undefined : family.reader.get(declaration),
  }) }), publish(nodes: readonly Node[], names: RustNamePlan): void {
    assertOpen();
    for (const node of nodes) {
      const name = names.nameForDeclaration(node);
      if (name !== undefined) family.writer.set(node, name);
    }
  } });
}

export type RustSourceNameProducer = ReturnType<typeof createRustSourceNameProducer>;
