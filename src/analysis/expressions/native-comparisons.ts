import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustTargetProgram } from "../program/model.js";
import type { RustNativeComparisonProducer } from "../program/records/native-comparisons.js";
import type { RustNativeComparison } from "../../target-model/records/native-comparisons.js";
import { isRustIntegerCarrier, isRustSignedNumericCarrier } from "../../target-model/types/index.js";

export function analyzeRustNativeComparisons(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustNativeComparisonProducer): void {
  const { ast } = program.source;
  for (const node of nodes) {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "operator-token" || !ast.is.IsBinaryExpression(node)) continue;
    const left = BinaryExpression_Left(ast, node);
    const right = BinaryExpression_Right(ast, node);
    if (left === undefined || right === undefined) continue;
    let selected: RustNativeComparison = { kind: "ordinary" };
    if (operation.operator === "&" && isRustIntegerCarrier(operation.resultCarrier) && isRustSignedNumericCarrier(operation.resultCarrier) &&
      operation.leftConversion === undefined && operation.rightConversion === undefined) {
      if (program.records.literalValue.get(right)?.integer === -1n) selected = { kind: "integer-identity", operand: "left" };
      else if (program.records.literalValue.get(left)?.integer === -1n) selected = { kind: "integer-identity", operand: "right" };
    }
    producer.publish(node, selected);
  }
}
