import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  Node_Operand,
  KindBinaryExpression,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindIdentifier,
  KindBigIntLiteral,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPrefixUnaryExpression,
  KindQuestionQuestionToken,
  KindStringLiteral,
  Node_Expression,
} from "@tsonic/target-api/source";
import {
  isRustAssignmentOperator,
  rustBinaryResultCarrierIsIndependentOfOperands,
  rustBinaryRightCarrierIsIndependentOfLeft,
  rustOperatorCarrierKey,
  selectRustBinaryOperator,
  selectRustCompoundAssignment,
  selectRustEquivalentAssignment,
} from "../../policy/operations/operator-rules.js";
import {
  isRustBigIntCarrier,
  isRustDefinitelyNullishCarrier,
  isRustNumericCarrier,
  isRustNullishSourceCarrier,
  isRustOptionCarrier,
  isRustStringCarrier,
  rustOptionElementCarrier,
  rustSourcePrimitiveTargetType,
} from "../../target-model/types/index.js";
import {
  rustModuleBindingFactKey,
  rustMutatedBindingFactKey,
  rustOptionProjectionFactKey,
  rustLocationStorageFactKey,
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
  rustTargetOperationFactKey,
  rustTargetOperationResultCarrier,
} from "../facts/keys.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { parseSourceBigIntLiteral } from "../../target-model/syntax/literals.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustSelectedOperationKey } from "../../target-model/facts/selections.js";
import { rustTargetOperationSupportsAssignment, rustTargetOperationText } from "../facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectedSourceLiteralIsRepresentable } from "../../policy/types/selected-numeric-literal.js";
import { setCarrierFact, setRustOperationFact } from "./project-calls.js";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
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
  const leftNode = BinaryExpression_Left(walk.context.ast, expression);
  const rightNode = BinaryExpression_Right(walk.context.ast, expression);
  const operatorToken = BinaryExpression_OperatorToken(walk.context.ast, expression);
  if (leftNode === undefined || rightNode === undefined || operatorToken === undefined) {
    return undefined;
  }
  const operatorKind = walk.context.ast.kindName(operatorToken);
  const selectedAssignmentValueCarrier = operatorKind === KindEqualsToken
    ? rustSelectedAssignmentValueCarrier(
        walk.context.facts.get(expression, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(expression, rustTargetOperationFactKey),
      )
    : undefined;
  if (rustBinaryResultCarrierIsIndependentOfOperands(operatorKind)) {
    const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken;
    let { left, right } = resolveContextualBinaryOperandCarriers(
      walk,
      leftNode,
      rightNode,
      sourceFile,
      undefined,
    );
    if (strictEquality && left !== undefined && right !== undefined &&
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
  let left = resolveExpressionCarrier(
    walk,
    leftNode,
    sourceFile,
    undefined,
  );
  if (left === undefined) {
    const leftSemanticCarrier = resolveRustTargetTypeRef(
      leftNode,
      rustResolutionContext(walk, leftNode),
      walk.operationOptions,
    );
    left = resolveExpressionCarrier(
      walk,
      leftNode,
      sourceFile,
      leftSemanticCarrier,
    );
  }
  const initialRightExpectation = operatorKind === KindQuestionQuestionToken
    ? rustOptionElementCarrier(left) ?? expected
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
    left = resolveExpressionCarrier(walk, leftNode, sourceFile, right);
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
        isRustNullishSourceCarrier(right) ? undefined : right,
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
        isRustNullishSourceCarrier(left) ? undefined : left,
      ),
    };
  }
  return {
    left: resolveExpressionCarrier(walk, leftNode, sourceFile, undefined),
    right: resolveExpressionCarrier(walk, rightNode, sourceFile, undefined),
  };
}

export function rustSelectedAssignmentValueCarrier(
  fact: RustTargetOperationFact | undefined,
): TargetTypeRef | undefined {
  if (fact?.kind !== "runtime-set") {
    return undefined;
  }
  const values = fact.abi.sourceArguments.filter((argument) =>
    argument.role === "parameter" && argument.disposition === "runtime");
  return values.length === 1 ? values[0]!.carrier : undefined;
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
  return false;
}

export function resolvePostCheckBinaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (walk.postCheckOperations.get(expression) !== "binary") {
    return undefined;
  }
  const operands = resolveBinaryOperandCarriers(walk, expression, sourceFile, expected, true);
  if (operands === undefined) {
    return undefined;
  }
  const { left, right, leftNode, operatorKind } = operands;
  const selectedLeftOperation = walk.context.facts.get(leftNode, rustSelectedOperationKey) ??
    walk.context.facts.resolve(leftNode, rustSelectedOperationKey);
  const selectedLeftFact = walk.context.facts.get(leftNode, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(leftNode, rustTargetOperationFactKey);
  const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
    operatorKind === KindExclamationEqualsEqualsToken;
  const leftComparisonCarrier = strictEquality
    ? strictEqualityOperandCarrier(walk, operands.leftNode, left)
    : left;
  const rightComparisonCarrier = strictEquality
    ? strictEqualityOperandCarrier(walk, operands.rightNode, right)
    : right;
  const leftOptionElement = rustOptionElementCarrier(leftComparisonCarrier);
  const rightOptionElement = rustOptionElementCarrier(rightComparisonCarrier);
  const optionNullishRelationship = selectedOptionNullishRelationship(
    walk,
    operands.leftNode,
    operands.rightNode,
    leftComparisonCarrier,
    rightComparisonCarrier,
  );
  const optionNullishOperand = isRustOptionCarrier(leftComparisonCarrier)
    ? "left" as const
    : isRustOptionCarrier(rightComparisonCarrier)
      ? "right" as const
      : undefined;
  const optionNullishCarrier = optionNullishOperand === "left"
    ? leftComparisonCarrier
    : optionNullishOperand === "right"
      ? rightComparisonCarrier
      : undefined;
  const comparedNullishCarrier = optionNullishOperand === "left"
    ? rightComparisonCarrier
    : optionNullishOperand === "right"
      ? leftComparisonCarrier
      : undefined;
  const optionValueOperand = leftOptionElement !== undefined && rightComparisonCarrier !== undefined &&
      rustTargetTypeRefEquals(leftOptionElement, rightComparisonCarrier)
    ? "left" as const
    : rightOptionElement !== undefined && leftComparisonCarrier !== undefined &&
        rustTargetTypeRefEquals(rightOptionElement, leftComparisonCarrier)
      ? "right" as const
      : undefined;
  let fact: RustTargetOperationFact | undefined;
  if (operatorKind === KindQuestionQuestionToken) {
    const inner = rustOptionElementCarrier(left);
    if (inner !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(inner, right)) {
      fact = {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce",
        rightOperand: "value",
        resultCarrier: inner,
      };
    } else if (inner !== undefined && left !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(left, right)) {
      fact = {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce-option",
        rightOperand: "option",
        resultCarrier: left,
      };
    } else if (inner !== undefined && isRustDefinitelyNullishCarrier(right) && left !== undefined) {
      fact = {
        kind: "nullish-identity",
        operationId: "tsonic.rust.option.coalesce-nullish-identity",
        resultCarrier: left,
      };
    } else if (left !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(left, right) &&
      !isRustOptionCarrier(left) && !isRustNullishSourceCarrier(left)) {
      fact = {
        kind: "nullish-identity",
        operationId: "tsonic.rust.nullish.identity",
        resultCarrier: left,
      };
    }
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    optionNullishRelationship === "member" &&
    optionNullishOperand !== undefined && optionNullishCarrier !== undefined &&
    comparedNullishCarrier !== undefined) {
    fact = {
      kind: "option-check",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.is-some"
        : "tsonic.rust.option.is-none",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionOperand: optionNullishOperand,
      optionCarrier: optionNullishCarrier,
      nullishCarrier: comparedNullishCarrier,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    optionNullishRelationship === "disjoint") {
    fact = {
      kind: "disjoint-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.equality.option-nullish-disjoint.not-equal"
        : "tsonic.rust.equality.option-nullish-disjoint.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: operatorKind === KindExclamationEqualsEqualsToken,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    isRustDefinitelyNullishCarrier(left) && isRustDefinitelyNullishCarrier(right) &&
    !rustTargetTypeRefEquals(left, right)) {
    fact = {
      kind: "disjoint-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.equality.nullish-disjoint.not-equal"
        : "tsonic.rust.equality.nullish-disjoint.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: operatorKind === KindExclamationEqualsEqualsToken,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    ((isRustDefinitelyNullishCarrier(left) && right !== undefined &&
        !isRustDefinitelyNullishCarrier(right) && !isRustOptionCarrier(right)) ||
      (isRustDefinitelyNullishCarrier(right) && left !== undefined &&
        !isRustDefinitelyNullishCarrier(left) && !isRustOptionCarrier(left)))) {
    fact = {
      kind: "disjoint-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.equality.disjoint.not-equal"
        : "tsonic.rust.equality.disjoint.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: operatorKind === KindExclamationEqualsEqualsToken,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    isRustOptionCarrier(leftComparisonCarrier) && isRustOptionCarrier(rightComparisonCarrier) &&
    leftComparisonCarrier !== undefined && rightComparisonCarrier !== undefined &&
    rustTargetTypeRefEquals(leftComparisonCarrier, rightComparisonCarrier)) {
    fact = {
      kind: "option-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.not-equal"
        : "tsonic.rust.option.equal",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionCarrier: leftComparisonCarrier,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) && optionValueOperand !== undefined) {
    const optionCarrier = optionValueOperand === "left" ? leftComparisonCarrier : rightComparisonCarrier;
    const valueCarrier = optionValueOperand === "left" ? rightComparisonCarrier : leftComparisonCarrier;
    if (optionCarrier === undefined || valueCarrier === undefined) {
      return undefined;
    }
    fact = {
      kind: "option-value-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.value-not-equal"
        : "tsonic.rust.option.value-equal",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionOperand: optionValueOperand,
      optionCarrier,
      valueCarrier,
    };
  } else if (operatorKind === KindEqualsToken &&
    (selectedLeftOperation === undefined || rustTargetOperationSupportsAssignment(selectedLeftFact)) &&
    left !== undefined && right !== undefined &&
    rustTargetTypeRefEquals(left, right)) {
    const equivalentOperator = selectEquivalentBindingAssignment(
      walk,
      leftNode,
      operands.rightNode,
      left,
    );
    fact = {
      kind: "operator-token",
      operationId: equivalentOperator === undefined
        ? `tsonic.rust.operator.=.${rustOperatorCarrierKey(right)}`
        : `tsonic.rust.operator.${equivalentOperator}.equivalent.${rustOperatorCarrierKey(right)}`,
      operator: equivalentOperator ?? "=",
      resultCarrier: right,
    };
  } else {
    const compound = selectRustCompoundAssignment(operatorKind, left, right);
    if (compound !== undefined && left !== undefined) {
      fact = compound.kind === "operator-call"
        ? {
            kind: "operator-call",
            operationId: `tsonic.rust.operator.${compound.operator}.${rustOperatorCarrierKey(left)}`,
            operator: compound.operator,
            path: compound.path,
            resultCarrier: compound.resultCarrier,
            fallible: compound.fallible,
            operandModes: compound.operandModes,
          }
        : {
            kind: "operator-token",
            operationId: `tsonic.rust.operator.${compound.operator}.${rustOperatorCarrierKey(left)}`,
            operator: compound.operator,
            resultCarrier: compound.resultCarrier,
          };
    } else {
      const binary = selectRustBinaryOperator(operatorKind, left, right);
      if (binary !== undefined) {
        fact = binary.kind === "string-concat"
          ? {
              kind: "string-concat",
              operationId: "tsonic.rust.operator.concat.string",
              resultCarrier: binary.resultCarrier,
            }
          : binary.kind === "operator-call"
            ? {
                kind: "operator-call",
                operationId: `tsonic.rust.operator.${binary.rustOperator}.${rustOperatorCarrierKey(binary.resultCarrier)}`,
                operator: binary.rustOperator,
                path: binary.path,
                resultCarrier: binary.resultCarrier,
                fallible: binary.fallible,
                operandModes: binary.operandModes,
                ...(binary.leftConversion === undefined
                  ? {}
                  : { leftConversion: binary.leftConversion }),
                ...(binary.rightConversion === undefined
                  ? {}
                  : { rightConversion: binary.rightConversion }),
              }
            : {
              kind: "operator-token",
              operationId: `tsonic.rust.operator.${binary.rustOperator}.${rustOperatorCarrierKey(binary.resultCarrier)}`,
              operator: binary.rustOperator,
              resultCarrier: binary.resultCarrier,
              leftConversion: binary.leftConversion,
              rightConversion: binary.rightConversion,
              };
      }
    }
  }
  const inPlaceStringAppend = fact?.kind === "operator-token" &&
      fact.operator === "+=" && isRustStringCarrier(fact.resultCarrier)
    ? inPlaceStringAppendDeclarationFor(walk, leftNode, operands.rightNode)
    : undefined;
  if (inPlaceStringAppend !== undefined && fact?.kind === "operator-token") {
    fact = { ...fact, writeStrategy: inPlaceStringAppend.writeStrategy };
    walk.context.facts.set(
      inPlaceStringAppend.declaration,
      rustMutatedBindingFactKey,
      { mutated: true },
      [{ message: "rust in-place string append requires mutable local storage" }],
    );
  }
  if (fact === undefined) {
    walk.postCheckOperations.delete(expression);
    if (operatorKind === KindEqualsToken && selectedLeftOperation !== undefined &&
      !rustTargetOperationSupportsAssignment(selectedLeftFact)) {
      appendRustDiagnostic(
        walk,
        "RUST_SELECTED_ASSIGNMENT_UNSUPPORTED",
        "Checked assignment target has no finalized Rust write operation.",
        expression,
        [
          "target.capability=rust.operation.assignment",
          `source.operatorKind=${operatorKind}`,
        ],
      );
    } else if (left !== undefined && right !== undefined) {
      const assignment = operatorKind === KindEqualsToken;
      appendRustDiagnostic(
        walk,
        assignment
          ? "RUST_ASSIGNMENT_CARRIER_UNSUPPORTED"
          : "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED",
        assignment
          ? "Checked assignment has no closed Rust operation for the finalized value carriers."
          : `Checked binary operator '${operatorKind}' has no closed Rust operation for the finalized operand carriers.`,
        expression,
        [
          `target.capability=rust.operation.${assignment ? "assignment" : "binary"}`,
          `source.operatorKind=${operatorKind}`,
          `left=${JSON.stringify(left)}`,
          `right=${JSON.stringify(right)}`,
        ],
      );
    }
    return undefined;
  }
  const resultCarrier = rustTargetOperationResultCarrier(fact);
  if (resultCarrier === undefined) {
    return undefined;
  }
  setRustOperationFact(walk, expression, fact);
  recordFinalizedOperatorSelection(walk, expression, fact, resultCarrier);
  return setCarrierFact(walk, expression, resultCarrier);
}

function inPlaceStringAppendDeclarationFor(
  walk: RustFactWalk,
  target: Node,
  value: Node,
): {
  readonly declaration: Node;
  readonly writeStrategy:
    | "in-place-string-append-parts"
    | "in-place-string-append-value";
} | undefined {
  if (walk.context.ast.kindName(target) !== KindIdentifier) {
    return undefined;
  }
  const reference = walk.context.source.navigation.sourceReferenceFor(target);
  if (reference === undefined || reference.symbol === undefined ||
    walk.context.facts.get(reference.declaration, rustModuleBindingFactKey) !== undefined ||
    walk.context.facts.resolve(reference.declaration, rustModuleBindingFactKey) !== undefined ||
    walk.context.facts.get(reference.declaration, rustLocationStorageFactKey) !== undefined ||
    walk.context.facts.resolve(reference.declaration, rustLocationStorageFactKey) !== undefined ||
    walk.context.source.navigation.declarationUseSummary(reference.declaration).captured ||
    walk.context.source.navigation.referencesWithin(reference.symbol, value).length !== 0) {
    return undefined;
  }
  const effects = walk.context.source.navigation.expressionEffects(value);
  return {
    declaration: reference.declaration,
    writeStrategy: !effects.invokes && !effects.mutates &&
        !effects.suspends && !effects.mayThrow
      ? "in-place-string-append-parts"
      : "in-place-string-append-value",
  };
}

function selectedOptionNullishRelationship(
  walk: RustFactWalk,
  leftNode: Node,
  rightNode: Node,
  leftCarrier: TargetTypeRef | undefined,
  rightCarrier: TargetTypeRef | undefined,
): "member" | "disjoint" | undefined {
  const leftIsOption = isRustOptionCarrier(leftCarrier);
  const rightIsOption = isRustOptionCarrier(rightCarrier);
  const optionNode = leftIsOption && isRustDefinitelyNullishCarrier(rightCarrier)
    ? leftNode
    : rightIsOption && isRustDefinitelyNullishCarrier(leftCarrier)
      ? rightNode
      : undefined;
  const nullishNode = optionNode === leftNode
    ? rightNode
    : optionNode === rightNode
      ? leftNode
      : undefined;
  if (optionNode === undefined || nullishNode === undefined) {
    return undefined;
  }
  const optionFact = walk.context.facts.get(optionNode, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(optionNode, rustTargetOperationFactKey);
  if (optionFact?.kind === "provider-operation" &&
    optionFact.sourceAbsenceCarrier !== undefined) {
    const comparedNullishCarrier = optionNode === leftNode ? rightCarrier : leftCarrier;
    if (comparedNullishCarrier === undefined) {
      return undefined;
    }
    return rustTargetTypeRefEquals(optionFact.sourceAbsenceCarrier, comparedNullishCarrier)
      ? "member"
      : "disjoint";
  }
  const optionSemantics = walk.context.semanticsFor(optionNode);
  const nullishSemantics = walk.context.semanticsFor(nullishNode);
  const optionType = optionSemantics.types.expressionType(optionNode);
  const nullishType = nullishSemantics.types.expressionType(nullishNode);
  if (optionType === undefined || nullishType === undefined ||
    !nullishSemantics.types.isNullish(nullishType)) {
    return undefined;
  }
  const members = optionSemantics.types.isUnion(optionType)
    ? optionSemantics.types.unionOrIntersectionTypes(optionType)
    : [optionType];
  const nullishMembers = members.filter((member) => optionSemantics.types.isNullish(member));
  if (nullishMembers.length !== 1) {
    return undefined;
  }
  return optionSemantics.types.relationship(nullishMembers[0]!, nullishType) === "identical"
    ? "member"
    : "disjoint";
}

function strictEqualityOperandCarrier(
  walk: RustFactWalk,
  operand: Node,
  effectiveCarrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const runtimeCarrier = walk.context.facts.getRuntimeCarrierFact(operand)?.carrier;
  if (isRustOptionCarrier(runtimeCarrier)) {
    return runtimeCarrier;
  }
  const optionProjection = walk.context.facts.getFact(operand, rustOptionProjectionFactKey);
  return optionProjection !== undefined && isRustOptionCarrier(optionProjection.resultCarrier)
    ? optionProjection.sourceCarrier
    : effectiveCarrier;
}

function selectEquivalentBindingAssignment(
  walk: RustFactWalk,
  target: Node,
  value: Node,
  targetCarrier: TargetTypeRef,
): RustAssignmentOperator | undefined {
  const { ast } = walk.context;
  if (ast.kindName(target) !== KindIdentifier || ast.kindName(value) !== KindBinaryExpression) {
    return undefined;
  }
  const valueLeft = BinaryExpression_Left(ast, value);
  if (valueLeft === undefined || ast.kindName(valueLeft) !== KindIdentifier) {
    return undefined;
  }
  const targetReference = walk.context.source.navigation.sourceReferenceFor(target);
  const valueReference = walk.context.source.navigation.sourceReferenceFor(valueLeft);
  if (targetReference?.symbol === undefined || valueReference?.symbol === undefined ||
    targetReference.symbol !== valueReference.symbol ||
    targetReference.declaration !== valueReference.declaration) {
    return undefined;
  }
  const valueFact = walk.context.facts.get(value, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(value, rustTargetOperationFactKey);
  return valueFact?.kind === "operator-token"
    ? selectRustEquivalentAssignment(valueFact.operator, targetCarrier, valueFact.resultCarrier)
    : undefined;
}

export function resolvePostCheckUnaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  _sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const pendingKind = walk.postCheckOperations.get(expression);
  const operand = Node_Operand(walk.context.ast, expression);
  const fixedWidthLiteral = expected?.kind === "source-primitive" &&
    isRustNumericCarrier(expected) &&
    selectedSourceLiteralIsRepresentable(expression, expected.name, walk.context.ast);
  const bigintLiteral = isRustBigIntCarrier(expected) && operand !== undefined &&
    walk.context.ast.kindName(operand) === KindBigIntLiteral &&
    parseSourceBigIntLiteral(walk.context.ast.text(operand)) !== undefined;
  if ((pendingKind !== "unary-minus" && pendingKind !== "unary-plus") ||
    expected === undefined || (!fixedWidthLiteral && !bigintLiteral)) {
    return undefined;
  }
  if (operand === undefined) {
    return undefined;
  }
  setCarrierFact(walk, operand, expected);
  const fact: RustTargetOperationFact = pendingKind === "unary-minus"
    ? {
        kind: "operator-token",
        operationId: rustPostCheckUnaryMinusOperationId,
        operator: "-",
        resultCarrier: expected,
      }
    : {
        kind: "source-conversion",
        operationId: rustPostCheckUnaryPlusOperationId,
        resultCarrier: expected,
      };
  setRustOperationFact(walk, expression, fact);
  recordFinalizedOperatorSelection(walk, expression, fact, expected);
  return setCarrierFact(walk, expression, expected);
}

export function recordFinalizedOperatorSelection(
  walk: RustFactWalk,
  expression: Node,
  fact: RustTargetOperationFact,
  resultType: TargetTypeRef,
): void {
  walk.context.facts.set(expression, rustSelectedOperationKey, {
    operationId: fact.operationId,
    operationKind: "operator",
    targetOperation: rustTargetOperationText(fact),
    resultType,
    provenance: { sourceExpression: expression },
  }, [{ message: `rust finalized operator ${fact.operationId}` }]);
}
