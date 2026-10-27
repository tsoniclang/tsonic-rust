import type { RustAssignmentOperationFact, RustAssignmentValueSelection } from "../../../target-model/records/operations/operator-selection.js";
import type { RustAssignmentOperator, RustBinaryOperator } from "../../../target-model/syntax/tokens.js";
import { isRustAssignmentOperator } from "../../../target-model/syntax/tokens.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";
import type { RustValueReadOwnership } from "../../../target-model/records/storage/ownership.js";

export function selectRustAssignmentValue(operation: RustAssignmentOperationFact, previous: RustValueReadOwnership): RustAssignmentValueSelection | undefined {
  if (operation.kind === "operator-call") return Object.freeze({ kind: "call", operation, previous });
  if (!isRustAssignmentOperator(operation.operator)) return undefined;
  if (operation.operator === "=") return Object.freeze({ kind: "plain", previous });
  if (operation.operator === "+=" && isRustStringCarrier(operation.resultCarrier)) return Object.freeze({ kind: "string-concat", previous });
  return Object.freeze({ kind: "binary", operator: binaryOperators[operation.operator], previous,
    leftConversion: operation.leftConversion, rightConversion: operation.rightConversion });
}

const binaryOperators: Readonly<Record<Exclude<RustAssignmentOperator, "=">, RustBinaryOperator>> = Object.freeze({
  "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%", "&=": "&", "|=": "|", "^=": "^", "<<=": "<<", ">>=": ">>",
});
