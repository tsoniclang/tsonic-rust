import type { Node } from "@tsonic/tsts";
import type { RustOptionalChainEmission, RustOptionalChainEmissionRecords } from "../../../../target-model/records/operations/optional-chain-emission.js";
import { createRustRecordFamily } from "../family.js";

export function createRustOptionalChainEmissionProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustOptionalChainEmission>({
    id: "tsonic.rust.optionalChainEmission", equals: (left, right) => left === right,
  }, assertOpen);
  const records: RustOptionalChainEmissionRecords = Object.freeze({ optionalChainEmission: family.reader });
  return Object.freeze({ records, publish: (node: Node, value: RustOptionalChainEmission): void =>
    family.writer.set(node, Object.freeze(value)) });
}

export type RustOptionalChainEmissionProducer = ReturnType<typeof createRustOptionalChainEmissionProducer>;
