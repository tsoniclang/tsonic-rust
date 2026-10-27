import { isRustBigIntCarrier, isRustIntegerCarrier, isRustBoolCarrier, isRustNumericCarrier, isRustSignedNumericCarrier } from "../../../target-model/types/index.js";

import type { RustOperatorToken } from "../../../target-model/syntax/tokens.js";

import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustCheckedUnaryOperation(operator: string, operand: TargetTypeRef | undefined): RustTargetOperationFact | undefined {
  let targetOperator: RustOperatorToken | undefined;
  let resultCarrier: TargetTypeRef | undefined;
  if (operator === "!" && isRustBoolCarrier(operand)) {
    targetOperator = "!";
    resultCarrier = operand;
  } else if (operator === "~" && operand !== undefined && isRustIntegerCarrier(operand)) {
    targetOperator = "!";
    resultCarrier = operand;
  } else if (operator === "~" && isRustBigIntCarrier(operand)) {
    targetOperator = "!";
    resultCarrier = operand;
  } else if (operator === "-" &&
    (isRustSignedNumericCarrier(operand) || isRustBigIntCarrier(operand))) {
    targetOperator = "-";
    resultCarrier = operand;
  } else if ((operator === "++" || operator === "--") &&
    (isRustNumericCarrier(operand) || isRustBigIntCarrier(operand))) {
    targetOperator = operator === "++" ? "+=" : "-=";
    resultCarrier = operand;
  } else if (operator === "+" && operand !== undefined && isRustNumericCarrier(operand)) {
    return {
      kind: "source-conversion",
      operationId: "tsonic.rust.operator.unary-plus",
      resultCarrier: operand,
    };
  }
  return targetOperator === undefined || resultCarrier === undefined
    ? undefined : operatorFact(targetOperator, resultCarrier);
}
function operatorFact(operator: RustOperatorToken, resultCarrier: TargetTypeRef): Extract<RustTargetOperationFact, { readonly kind: "operator-token" }> {
  return {
    kind: "operator-token",
    operationId: `tsonic.rust.operator.${operator}.${rustCarrierIdentity(resultCarrier)}`,
    operator,
    resultCarrier,
    operandModes: [operator === "+=" || operator === "-=" ? "mut-ref" : "value"],
  };
}

function rustCarrierIdentity(carrier: TargetTypeRef): string {
  if (carrier.kind === "source-primitive") {
    return carrier.name;
  }
  if (carrier.kind === "target-named") {
    return carrier.id;
  }
  return carrier.kind;
}
