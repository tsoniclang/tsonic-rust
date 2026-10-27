import type { Node } from "@tsonic/tsts";
import type { RustSourceBindingEmission } from "../../../../target-model/records/storage/binding-paths.js";
import { createRustRecordFamily } from "../family.js";

export function createRustSourceBindingEmissionProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustSourceBindingEmission>({
    id: "tsonic.rust.sourceBindingEmission", equals: (left, right) => left === right,
  }, assertOpen);
  return Object.freeze({ records: Object.freeze({ sourceBindingEmission: family.reader }),
    publish(declaration: Node, value: RustSourceBindingEmission): void {
      family.writer.set(declaration, Object.freeze(value));
    },
  });
}

export type RustSourceBindingEmissionProducer = ReturnType<typeof createRustSourceBindingEmissionProducer>;
