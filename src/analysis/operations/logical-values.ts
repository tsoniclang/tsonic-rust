import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, sourceBooleanShortCircuitBranch } from "@tsonic/target-api/source";
import { finalizeValueConversion } from "../facts/finalized-operation/conversions.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { resolveRustBranchUnion } from "../../policy/types/resolution/branch-unions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustBoolCarrier } from "../../target-model/types/index.js";
import { appendRustDiagnostic, rustResolutionContext, type RustFactWalk } from "../program/walk.js";
import { recordTargetOperation, setCarrierFact, setRustOperationFact } from "./project-calls.js";

export function recordRustLogicalValueFact(walk: RustFactWalk, expression: Node): boolean {
  const ast = walk.context.ast;
  const operator = ast.operatorKindName(expression);
  if (operator !== "KindAmpersandAmpersandToken" && operator !== "KindBarBarToken") return false;
  const leftNode = BinaryExpression_Left(ast, expression);
  const rightNode = BinaryExpression_Right(ast, expression);
  if (leftNode === undefined || rightNode === undefined) return false;
  const left = walk.context.facts.getRuntimeCarrierFact(leftNode)?.carrier;
  const right = walk.context.facts.getRuntimeCarrierFact(rightNode)?.carrier;
  if (!isRustBoolCarrier(left) || right === undefined || isRustBoolCarrier(right)) return false;
  const branch = sourceBooleanShortCircuitBranch(ast, leftNode, operator === "KindAmpersandAmpersandToken" ? "&&" : "||");
  const result = branch === "left" ? left : branch === "right" ? right : resolveRustBranchUnion(expression,
    [{ expression: leftNode, carrier: left! }, { expression: rightNode, carrier: right }],
    rustResolutionContext(walk, expression), walk.operationOptions);
  const conversion = (carrier: TargetTypeRef) => result === undefined ? undefined : finalizeValueConversion(
    selectRustSourceValueConversion(carrier, result, walk.context.typeDefinitions), carrier, result, walk.context.typeDefinitions);
  const leftConversion = branch === "right" ? null : conversion(left!);
  const rightConversion = branch === "left" ? null : conversion(right);
  if (result === undefined || leftConversion === undefined || rightConversion === undefined) {
    appendRustDiagnostic(walk, "RUST_LOGICAL_VALUE_BRANCH_NOT_CLOSED",
      "Boolean-controlled short circuit requires one exact native result and a complete conversion for each branch.", expression, []);
    return true;
  }
  const operationId = "tsonic.rust.syntax.logical-value";
  setRustOperationFact(walk, expression, { kind: "logical-value", operationId,
    operator: operator === "KindAmpersandAmpersandToken" ? "and" : "or", branch,
    leftCarrier: left!, rightCarrier: right, resultCarrier: result, leftConversion, rightConversion });
  recordTargetOperation(walk, expression, operationId, "operator", operationId, result);
  setCarrierFact(walk, expression, result);
  return true;
}
