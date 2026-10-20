import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
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
    if (selected.kind === "ordinary" && operation.leftConversion === undefined && operation.rightConversion === undefined) {
      const leftInteger = program.records.literalValue.get(left)?.integer;
      const rightInteger = program.records.literalValue.get(right)?.integer;
      const reversed: Readonly<Record<string, string>> = { "==": "==", "!=": "!=", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
      const boundary = rightInteger === 0n || rightInteger === 1n
        ? { operand: "left" as const, node: left, operator: operation.operator, integer: rightInteger }
        : (leftInteger === 0n || leftInteger === 1n) && reversed[operation.operator] !== undefined
          ? { operand: "right" as const, node: right, operator: reversed[operation.operator]!, integer: leftInteger } : undefined;
      const carrier = boundary === undefined ? undefined : program.records.valueRead.get(boundary.node)?.value;
      if (boundary !== undefined && isRustIntegerCarrier(carrier) && !isRustSignedNumericCarrier(carrier)) {
        const normalized = boundary.integer === 0n ? boundary.operator : boundary.operator === "<" ? "==" : boundary.operator === ">=" ? "!=" : undefined;
        if (normalized === "<" || normalized === ">=") selected = { kind: "unsigned-constant", operand: boundary.operand,
          value: normalized === ">=", evaluate: program.records.literalValue.get(boundary.node)?.integer === undefined };
        else {
          const operator = normalized === "<=" || normalized === "==" ? "==" : normalized === ">" || normalized === "!=" ? "!=" : undefined;
          if (operator !== undefined) {
            let empty: Extract<RustNativeComparison, { readonly kind: "unsigned-zero" }>["empty"];
            const provider = program.records.targetOperation.get(boundary.node);
            const abi = provider?.kind === "provider-operation" ? provider.abi : undefined;
            const receiver = Node_Expression(ast, boundary.node);
            if (abi?.operationKind === "property" && abi.effects.invocation === "infallible" && abi.effects.evaluation === "pure" &&
              abi.result.kind === "sync" && abi.result.conversion.kind === "identity" && abi.target.form === "receiver-method" &&
              abi.target.emptyTestMethod !== undefined && (abi.target.chain?.length ?? 0) === 0 &&
              abi.sourceReceiver.kind === "receiver" && abi.targetReceiver.kind === "input" &&
              abi.sourceArguments.length === 0 && abi.targetArguments.length === 0 && receiver !== undefined)
              empty = Object.freeze({ receiver, input: abi.targetReceiver.input, method: abi.target.emptyTestMethod });
            selected = { kind: "unsigned-zero", operand: boundary.operand, operator, empty };
          }
        }
      }
    }
    producer.publish(node, selected);
  }
}
