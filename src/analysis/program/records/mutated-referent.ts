import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustMutatedReferentProducer {
  readonly records: RustRecordFamily<{ readonly mutated: true }>;
  written(declaration: Node): void;
}

export function createRustMutatedReferentProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<{ readonly mutated: true }>,
): RustMutatedReferentProducer {
  const family = createRustRecordFamily<{ readonly mutated: true }>({
    id: "tsonic.rust.mutatedReferent", equals: () => true,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    written(declaration: Node): void {
      family.writer.set(declaration, mutated);
    },
  });
}

const mutated = Object.freeze({ mutated: true as const });
