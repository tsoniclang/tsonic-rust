import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, Node_Expression, Node_Operand } from "@tsonic/target-api/source";

import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustBorrowPrimitiveCopyValue, rustBorrowPureCopyValue, rustBorrowPureProviderInputs,
  rustBorrowValueIsUnprojected } from "../program/borrowed-element-purity.js";
import { rustSourceValueWrapperContains } from "../../policy/ownership/source-value-wrappers.js";

export const rustNoNativeWrites: readonly Node[] = Object.freeze([]);

export function rustNativeWriteTargets(node: Node, input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
}, targetsFor: (node: Node) => readonly Node[] | undefined, directField: (node: Node) => boolean,
reserve: (count: number) => boolean): readonly Node[] | undefined {
  const { ast, records } = input;
  if (ast.is.IsIdentifier(node) && records.sourceBinding.get(node)?.scope === "lexical" ||
    ["KindStringLiteral", "KindNoSubstitutionTemplateLiteral", "KindBigIntLiteral", "KindNullKeyword"].includes(ast.kindName(node))) {
    return rustNoNativeWrites;
  }
  const wrapped = Node_Expression(ast, node);
  if (wrapped !== undefined && rustSourceValueWrapperContains(node, wrapped, ast)) return targetsFor(wrapped);
  const operation = records.targetOperation.get(node);
  if (ast.is.IsBinaryExpression(node) && operation?.kind === "sequence" && rustBorrowValueIsUnprojected(node, records)) {
    const left = BinaryExpression_Left(ast, node);
    const right = BinaryExpression_Right(ast, node);
    const preceding = left === undefined ? undefined : targetsFor(left);
    const following = right === undefined ? undefined : targetsFor(right);
    if (preceding === undefined || following === undefined) return undefined;
    const count = preceding.length + following.length;
    return count === 0 ? rustNoNativeWrites : reserve(count) ? Object.freeze([...preceding, ...following]) : undefined;
  }
  if (ast.is.IsBinaryExpression(node) && operation?.kind === "operator-token" && operation.operator === "=") {
    const target = BinaryExpression_Left(ast, node);
    const value = BinaryExpression_Right(ast, node);
    const writes = value === undefined ? undefined : targetsFor(value);
    return target !== undefined && ast.is.IsIdentifier(target) &&
      records.sourceBinding.get(target)?.scope === "lexical" && writes !== undefined && reserve(writes.length + 1)
      ? Object.freeze([...writes, target]) : undefined;
  }
  const providerInputs = rustBorrowPureProviderInputs(node, ast, records);
  if (providerInputs !== undefined) {
    if (providerInputs.some(child => targetsFor(child) === undefined)) return undefined;
    const count = providerInputs.reduce((total, child) => total + targetsFor(child)!.length, 0);
    return count === 0 ? rustNoNativeWrites : reserve(count)
      ? Object.freeze(providerInputs.flatMap(child => targetsFor(child)!)) : undefined;
  }
  if (rustBorrowPureCopyValue(node, ast, records, child => targetsFor(child) !== undefined)) {
    const children: Node[] = [];
    const operation = records.targetOperation.get(node);
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
    return count === 0 ? rustNoNativeWrites : reserve(count)
      ? Object.freeze(children.flatMap(child => targetsFor(child) ?? rustNoNativeWrites)) : undefined;
  }
  const field = records.targetOperation.get(node);
  if (directField(node) && (field?.kind === "source-field" && field.accessMode === "read" ||
    field?.kind === "tuple-index" || field?.kind === "fixed-index")) {
    const receiver = Node_Expression(ast, node);
    const key = ast.is.IsElementAccessExpression(node) ? ElementAccessExpression_ArgumentExpression(ast, node) : undefined;
    if (receiver === undefined || ast.is.IsElementAccessExpression(node) && key === undefined) return undefined;
    const receiverWrites = targetsFor(receiver);
    const keyWrites = key === undefined ? rustNoNativeWrites : targetsFor(key);
    if (receiverWrites === undefined || keyWrites === undefined) return undefined;
    const count = receiverWrites.length + keyWrites.length;
    return count === 0 ? rustNoNativeWrites : reserve(count)
      ? Object.freeze([...receiverWrites, ...keyWrites]) : undefined;
  }
  if (!ast.is.IsPrefixUnaryExpression(node) && !ast.is.IsPostfixUnaryExpression(node)) return undefined;
  const operand = Node_Operand(ast, node);
  const target = operand === undefined ? undefined : records.targetOperation.get(operand);
  return operation?.kind === "operator-token" && (operation.operator === "+=" || operation.operator === "-=") &&
    operation.leftConversion === undefined && operation.rightConversion === undefined &&
    operand !== undefined && rustBorrowPrimitiveCopyValue(operand, records) && directField(operand) &&
    target?.kind === "source-field" && target.accessMode === "read-write" && reserve(1)
    ? Object.freeze([operand]) : undefined;
}
