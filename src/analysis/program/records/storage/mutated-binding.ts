import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustMutatedBindingProducer {
  readonly records: RustRecordFamily<{ readonly mutated: true }>;
  written(declaration: Node): void;
}

export function createRustMutatedBindingProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<{ readonly mutated: true }>,
): RustMutatedBindingProducer {
  const family = createRustRecordFamily<{ readonly mutated: true }>({
    id: "tsonic.rust.mutatedBinding", equals: () => true,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    written(declaration: Node): void {
      assertOpen();
      if (family.reader.get(declaration) === undefined) family.writer.set(declaration, mutated);
    },
  });
}

const mutated = Object.freeze({ mutated: true as const });
