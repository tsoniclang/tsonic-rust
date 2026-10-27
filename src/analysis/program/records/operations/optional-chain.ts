import type { Node } from "@tsonic/tsts";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustOptionalChainFact } from "../../../../target-model/operations/model.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export type RustOptionalChainContract = Omit<RustOptionalChainFact, "expression" | "guard" | "operationKind">;

export interface RustOptionalChainProducer {
  readonly records: RustRecordFamily<RustOptionalChainFact>;
  guard(expression: Node, guard: Node, operationKind: RustOptionalChainFact["operationKind"],
    contract: RustOptionalChainContract): void;
}

export function createRustOptionalChainProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustOptionalChainFact>,
): RustOptionalChainProducer {
  const family = createRustRecordFamily<RustOptionalChainFact>({
    id: "tsonic.rust.optionalChain",
    equals: (left, right) => {
      const { expression: leftExpression, guard: leftGuard, ...leftMetadata } = left;
      const { expression: rightExpression, guard: rightGuard, ...rightMetadata } = right;
      return leftExpression === rightExpression && leftGuard === rightGuard &&
        closedMetadataEquals(leftMetadata, rightMetadata);
    },
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    guard(expression: Node, guard: Node, operationKind: RustOptionalChainFact["operationKind"],
      contract: RustOptionalChainContract): void {
      family.writer.set(expression, Object.freeze({ expression, guard, operationKind,
        sourceGuardCarrier: contract.sourceGuardCarrier, selectedGuardCarrier: contract.selectedGuardCarrier,
        guardDepth: contract.guardDepth, innerResultCarrier: contract.innerResultCarrier,
        resultCarrier: contract.resultCarrier, lowering: contract.lowering }));
    },
  });
}
