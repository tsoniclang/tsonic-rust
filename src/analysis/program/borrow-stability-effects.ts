import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Operand } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import type { RustTargetProgram } from "./model.js";
import { rustBorrowPrimitiveCopyValue, rustBorrowPureCopyValue, rustBorrowPureProviderInputs } from "./borrowed-element-purity.js";

export const rustNoNativeCopyWrites: readonly Node[] = Object.freeze([]);

export function rustNativeCopyWriteTargets(node: Node, input: {
  readonly ast: AstReader;
  readonly facts: RustTargetProgram["facts"];
}, targetsFor: (node: Node) => readonly Node[] | undefined, directField: (node: Node) => boolean,
reserve: (count: number) => boolean): readonly Node[] | undefined {
  const { ast, facts } = input;
  const providerInputs = rustBorrowPureProviderInputs(node, ast, facts);
  if (providerInputs !== undefined) {
    if (providerInputs.some(child => targetsFor(child) === undefined)) return undefined;
    const count = providerInputs.reduce((total, child) => total + targetsFor(child)!.length, 0);
    return count === 0 ? rustNoNativeCopyWrites : reserve(count)
      ? Object.freeze(providerInputs.flatMap(child => targetsFor(child)!)) : undefined;
  }
  if (rustBorrowPureCopyValue(node, ast, facts, child => targetsFor(child) !== undefined)) {
    const children: Node[] = [];
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if (ast.is.IsBinaryExpression(node) && operation?.kind === "operator-token") {
      const left = BinaryExpression_Left(ast, node);
      const right = BinaryExpression_Right(ast, node);
      if (left !== undefined) children.push(left);
      if (right !== undefined) children.push(right);
    } else if (ast.is.IsParenthesizedExpression(node)) {
      const inner = Node_Expression(ast, node);
      if (inner !== undefined) children.push(inner);
    }
    const count = children.reduce((total, child) => total + (targetsFor(child)?.length ?? 0), 0);
    return count === 0 ? rustNoNativeCopyWrites : reserve(count)
      ? Object.freeze(children.flatMap(child => targetsFor(child) ?? rustNoNativeCopyWrites)) : undefined;
  }
  const field = facts.getFact(node, rustTargetOperationFactKey);
  if (directField(node) && field?.kind === "source-field" && field.accessMode === "read") return rustNoNativeCopyWrites;
  if (!ast.is.IsPrefixUnaryExpression(node) && !ast.is.IsPostfixUnaryExpression(node)) return undefined;
  const operation = facts.getFact(node, rustTargetOperationFactKey);
  const operand = Node_Operand(ast, node);
  const target = operand === undefined ? undefined : facts.getFact(operand, rustTargetOperationFactKey);
  return operation?.kind === "operator-token" && (operation.operator === "+=" || operation.operator === "-=") &&
    operation.leftConversion === undefined && operation.rightConversion === undefined &&
    operand !== undefined && rustBorrowPrimitiveCopyValue(operand, facts) && directField(operand) &&
    target?.kind === "source-field" && target.accessMode === "read-write" && reserve(1)
    ? Object.freeze([operand]) : undefined;
}
