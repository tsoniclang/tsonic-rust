import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

type RustCompoundWriteFact = Extract<RustTargetOperationFact, { readonly kind: "runtime-set" }>;

export interface RustCompoundWriteProducer {
  readonly records: RustRecordFamily<RustCompoundWriteFact>;
  index(expression: Node, operationId: string, abi: RustCompoundWriteFact["abi"]): void;
}

export function createRustCompoundWriteProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustCompoundWriteFact>,
): RustCompoundWriteProducer {
  const family = createRustRecordFamily<RustCompoundWriteFact>({
    id: "tsonic.rust.compoundWrite", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    index(expression: Node, operationId: string, abi: RustCompoundWriteFact["abi"]): void {
      assertOpen();
      family.writer.set(expression, { kind: "runtime-set", operationId, abi });
    },
  });
}
