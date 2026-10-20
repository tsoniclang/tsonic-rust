import { rustSelectedAssignmentValueCarrier } from "../../policy/operations/operators/assignment-values.js";

import { sourceIntegerConstantValue, BinaryExpression_Left, BinaryExpression_OperatorToken, BinaryExpression_Right, Node_Operand, KindEqualsEqualsEqualsToken, KindEqualsToken, KindExclamationEqualsEqualsToken, KindInKeyword, KindBigIntLiteral, KindNumericLiteral, KindParenthesizedExpression, KindPrefixUnaryExpression, KindQuestionQuestionToken, KindQuestionQuestionEqualsToken, KindStringLiteral, Node_Expression } from "@tsonic/target-api/source";

import { selectRustProgramErrorEquality } from "./error-equality.js";

import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";
import { rustSourceOptionalElementCarrier } from "../../target-model/types/carriers/optional.js";

import { isRustAssignmentOperator, rustBinaryResultCarrierIsIndependentOfOperands, rustBinaryRightCarrierIsIndependentOfLeft, selectRustBinaryOperator } from "../../policy/operations/operators/rules.js";
import { isRustBigIntCarrier, isRustAbsenceCarrier, isRustNumericCarrier, isRustOptionCarrier, rustOptionValueCarrier, rustTsValueTargetType } from "../../target-model/types/index.js";

import { rustResolutionContext } from "../program/walk.js";

import { rustUnparenthesizedExpression } from "../../source/extension/expressions.js";
import { resolveExpressionCarrier, resolveExpressionCarrierBeforeFlowReadProjection } from "../expressions/carriers.js";
import { resolveRustTargetTypeRef } from "../types/resolution/source.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { selectedIntegerLiteralJoin, selectedIntegerLiteralUnionJoin, selectedSourceLiteralIsRepresentable } from "../../policy/conversions/literals.js";

import type { AstReader, Node, SourceFile } from "@tsonic/tsts";

import type { RustFactWalk } from "../program/walk.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";

export function resolveBinaryOperandCarriers(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  useAssignmentReadCarrier: boolean = false,
): {
  readonly left: TargetTypeRef | undefined;
  readonly right: TargetTypeRef | undefined;
  readonly leftNode: Node;
  readonly rightNode: Node;
  readonly operatorKind: string;
} | undefined {
  let leftNode = BinaryExpression_Left(walk.context.ast, expression);
  let rightNode = BinaryExpression_Right(walk.context.ast, expression);
  const operatorToken = BinaryExpression_OperatorToken(walk.context.ast, expression);
  if (leftNode === undefined || rightNode === undefined || operatorToken === undefined) {
    return undefined;
  }
  let operatorKind = walk.context.ast.kindName(operatorToken);
  if (operatorKind === "KindCommaToken") {
    return {
      left: resolveExpressionCarrier(walk, leftNode, sourceFile, undefined),
      right: resolveExpressionCarrier(walk, rightNode, sourceFile, expected),
      leftNode,
      rightNode,
      operatorKind,
    };
  }
  if (operatorKind === KindQuestionQuestionToken) {
    leftNode = rustUnparenthesizedExpression(walk.context.ast, leftNode);
    rightNode = rustUnparenthesizedExpression(walk.context.ast, rightNode);
  }
  if (operatorKind === KindQuestionQuestionEqualsToken) {
    const target = assignmentTarget(walk.context.ast, leftNode);
    const left = resolveExpressionCarrierBeforeFlowReadProjection(walk, target, sourceFile, undefined);
    const location = walk.context.records.targetOperation.get(target);
    const storage = location?.kind === "source-accessor" ? location.write?.valueCarrier : left;
    const right = resolveExpressionCarrier(walk, rightNode, sourceFile, storage);
    return { left, right, leftNode, rightNode, operatorKind };
  }
  if (operatorKind === KindInKeyword) {
    return {
      left: resolveExpressionCarrier(walk, leftNode, sourceFile, undefined),
      right: resolveExpressionCarrier(walk, rightNode, sourceFile, undefined),
      leftNode,
      rightNode,
      operatorKind,
    };
  }
  const selectedAssignmentValueCarrier = operatorKind === KindEqualsToken
    ? rustSelectedAssignmentValueCarrier(
        walk.context.records.targetOperation.get(expression),
      )
    : undefined;
  if (rustBinaryResultCarrierIsIndependentOfOperands(operatorKind)) {
    let { left, right } = resolveContextualBinaryOperandCarriers(
      walk,
      leftNode,
      rightNode,
      sourceFile,
      undefined,
    );
    if (isRustAbsenceCarrier(left) || isRustAbsenceCarrier(right)) {
      if (operatorKind === "KindEqualsEqualsToken") operatorKind = KindEqualsEqualsEqualsToken;
      if (operatorKind === "KindExclamationEqualsToken") operatorKind = KindExclamationEqualsEqualsToken;
    }
    const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken;
    if (strictEquality && left !== undefined && right !== undefined &&
      selectRustProgramErrorEquality(walk, left, right, operatorKind === KindExclamationEqualsEqualsToken) === undefined &&
      rustUnionAlternatives(left.kind === "target-named" ? rustSourceOptionalElementCarrier(left) ?? left : left, walk.context.typeDefinitions) === undefined &&
      rustUnionAlternatives(right.kind === "target-named" ? rustSourceOptionalElementCarrier(right) ?? right : right, walk.context.typeDefinitions) === undefined &&
      left.kind !== "type-parameter" && right.kind !== "type-parameter" &&
      selectRustBinaryOperator(operatorKind, left, right) === undefined) {
      const rightAsLeft = resolveExpressionCarrier(walk, rightNode, sourceFile, left);
      if (rightAsLeft !== undefined &&
        selectRustBinaryOperator(operatorKind, left, rightAsLeft) !== undefined) {
        right = rightAsLeft;
      } else {
        const leftAsRight = resolveExpressionCarrier(walk, leftNode, sourceFile, right);
        if (leftAsRight !== undefined &&
          selectRustBinaryOperator(operatorKind, leftAsRight, right) !== undefined) {
          left = leftAsRight;
        }
      }
    }
    return { left, right, leftNode, rightNode, operatorKind };
  }
  if (operatorKind !== KindQuestionQuestionToken &&
    !isRustAssignmentOperator(operatorKind) &&
    !rustBinaryRightCarrierIsIndependentOfLeft(operatorKind)) {
    const { left, right } = resolveContextualBinaryOperandCarriers(
      walk,
      leftNode,
      rightNode,
      sourceFile,
      expected,
    );
    return { left, right, leftNode, rightNode, operatorKind };
  }
  const resolveLeft = (expectation: TargetTypeRef | undefined): TargetTypeRef | undefined =>
    operatorKind === KindEqualsToken
      ? resolveExpressionCarrierBeforeFlowReadProjection(
          walk,
          leftNode,
          sourceFile,
          expectation,
        )
      : resolveExpressionCarrier(
          walk,
          leftNode,
          sourceFile,
          expectation,
        );
  let left = resolveLeft(
    undefined,
  );
  if (left === undefined) {
    const leftSemanticCarrier = resolveRustTargetTypeRef(
      leftNode,
      rustResolutionContext(walk, leftNode),
      walk.operationOptions,
    );
    left = resolveLeft(leftSemanticCarrier);
  }
  const initialRightExpectation = operatorKind === KindQuestionQuestionToken
    ? isRustOptionCarrier(left) ? selectedIntegerLiteralJoin(walk.context.literalValues.literalValue.get(rightNode), rustOptionValueCarrier(left)) ?? rustOptionValueCarrier(left) : expected
    : operatorKind === KindEqualsToken
      ? selectedAssignmentValueCarrier ??
        (useAssignmentReadCarrier ? left : undefined)
      : rustBinaryRightCarrierIsIndependentOfLeft(operatorKind)
        ? undefined
        : left;
  let right = resolveExpressionCarrier(
    walk,
    rightNode,
    sourceFile,
    initialRightExpectation,
  );
  if (left === undefined && right !== undefined) {
    left = resolveLeft(right);
  }
  if (right === undefined && left !== undefined &&
    (operatorKind !== KindEqualsToken || useAssignmentReadCarrier)) {
    right = resolveExpressionCarrier(walk, rightNode, sourceFile, left);
  }
  return {
    left,
    right,
    leftNode,
    rightNode,
    operatorKind,
  };
}

function resolveContextualBinaryOperandCarriers(
  walk: RustFactWalk,
  leftNode: Node,
  rightNode: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): {
  readonly left: TargetTypeRef | undefined;
  readonly right: TargetTypeRef | undefined;
} {
  const leftUsesContext = expressionUsesContextualLiteralCarrier(walk.context.ast, leftNode);
  const rightUsesContext = expressionUsesContextualLiteralCarrier(walk.context.ast, rightNode);
  if (leftUsesContext && rightUsesContext && expected !== undefined) {
    return {
      left: resolveExpressionCarrier(walk, leftNode, sourceFile, expected),
      right: resolveExpressionCarrier(walk, rightNode, sourceFile, expected),
    };
  }
  if (leftUsesContext && !rightUsesContext) {
    const right = resolveExpressionCarrier(walk, rightNode, sourceFile, undefined);
    return {
      left: resolveExpressionCarrier(
        walk,
        leftNode,
        sourceFile,
        contextualBinaryLiteralCarrier(walk, leftNode, right),
      ),
      right,
    };
  }
  if (rightUsesContext && !leftUsesContext) {
    const left = resolveExpressionCarrier(walk, leftNode, sourceFile, undefined);
    return {
      left,
      right: resolveExpressionCarrier(
        walk,
        rightNode,
        sourceFile,
        contextualBinaryLiteralCarrier(walk, rightNode, left),
      ),
    };
  }
  return {
    left: resolveExpressionCarrier(walk, leftNode, sourceFile, undefined),
    right: resolveExpressionCarrier(walk, rightNode, sourceFile, undefined),
  };
}

function contextualBinaryLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  counterpart: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const present = rustSourceOptionalElementCarrier(counterpart) ?? counterpart;
  return present === undefined || rustUnionAlternatives(present, walk.context.typeDefinitions) === undefined
    ? contextualLiteralOperandCarrier(walk, expression, counterpart)
    : selectedIntegerLiteralUnionJoin(walk.context.literalValues.literalValue.get(expression), present, walk.context.typeDefinitions);
}

function contextualLiteralOperandCarrier(
  walk: RustFactWalk,
  expression: Node,
  counterpart: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const ast = walk.context.ast;
  if (isRustAbsenceCarrier(counterpart) || counterpart?.kind === "type-parameter" ||
    rustTargetTypeRefEquals(counterpart, rustTsValueTargetType())) return undefined;
  const integerJoin = selectedIntegerLiteralJoin(walk.context.literalValues.literalValue.get(expression), counterpart);
  if (integerJoin !== undefined) return integerJoin;
  const kind = ast.kindName(expression);
  if (kind === KindPrefixUnaryExpression || kind === KindParenthesizedExpression) {
    const operand = kind === KindPrefixUnaryExpression ? Node_Operand(ast, expression) : Node_Expression(ast, expression);
    return operand === undefined ? undefined : contextualLiteralOperandCarrier(walk, operand, counterpart);
  }
  if (kind === KindNumericLiteral && isRustBigIntCarrier(counterpart) ||
    kind === KindBigIntLiteral && isRustNumericCarrier(counterpart) &&
      (counterpart.name === "float64" || counterpart.name === "float32")) return undefined;
  if (kind === KindNumericLiteral && isRustNumericCarrier(counterpart) &&
    !selectedSourceLiteralIsRepresentable(walk.context.literalValues.literalValue.get(expression), counterpart.name)) return undefined;
  return counterpart;
}

function expressionUsesContextualLiteralCarrier(ast: AstReader, expression: Node): boolean {
  const kind = ast.kindName(expression);
  if (kind === KindNumericLiteral || kind === KindBigIntLiteral || kind === KindStringLiteral) {
    return true;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindParenthesizedExpression) {
    const operand = kind === KindPrefixUnaryExpression
      ? Node_Operand(ast, expression)
      : Node_Expression(ast, expression);
    return operand !== undefined && expressionUsesContextualLiteralCarrier(ast, operand);
  }
  if (ast.is.IsBinaryExpression(expression)) return sourceIntegerConstantValue(ast, expression) !== undefined;
  return false;
}

export function assignmentTarget(ast: AstReader, expression: Node): Node {
  let target = expression;
  while (ast.kindName(target) === KindParenthesizedExpression) {
    const inner = Node_Expression(ast, target);
    if (inner === undefined) break;
    target = inner;
  }
  return target;
}
