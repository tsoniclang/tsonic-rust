import { selectedOptionNullishRelationship } from "./nullish-comparisons.js";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  Node_Operand,
  KindBinaryExpression,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  KindExpressionStatement,
  KindExclamationEqualsEqualsToken,
  KindIdentifier,
  KindInKeyword,
  KindBigIntLiteral,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPrefixUnaryExpression,
  KindQuestionQuestionToken,
  KindQuestionQuestionEqualsToken,
  KindStringLiteral,
  Node_Expression,
} from "@tsonic/target-api/source";
import { selectRustGenericNumericOperation } from "./generic-numeric.js";
import { selectRustProgramErrorEquality } from "./error-equality.js";
import { recordRustCompoundWrite } from "./provider/compound-writes.js";
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
  isRustNeverCarrier,
  isRustNumericCarrier,
  isRustNullishSourceCarrier,
  isRustOptionCarrier,
  isRustStringCarrier,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustOptionValueCarrier,
  rustBigIntTargetType,
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
import { rustUnparenthesizedExpression } from "../../target-model/syntax/expressions.js";
import {
  resolveExpressionCarrier,
  resolveExpressionCarrierBeforeFlowReadProjection,
} from "../expressions/carriers.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustSelectedOperationKey } from "../../target-model/facts/selections.js";
import { rustTargetOperationSupportsAssignment, rustTargetOperationText } from "../facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustOptionNestingDepth } from "../../target-model/types/carriers/optional.js";
import { rustValueCarrierBeforeContextualConversion, rustValueCarrierBeforeOptionProjection } from "../facts/value-carrier-queries.js";
import { rustRuntimeUnionContract, rustRuntimeUnionProjection } from "../../target-model/types/carriers/runtime-unions.js";
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
  let leftNode = BinaryExpression_Left(walk.context.ast, expression);
  let rightNode = BinaryExpression_Right(walk.context.ast, expression);
  const operatorToken = BinaryExpression_OperatorToken(walk.context.ast, expression);
  if (leftNode === undefined || rightNode === undefined || operatorToken === undefined) {
    return undefined;
  }
  const operatorKind = walk.context.ast.kindName(operatorToken);
  if (operatorKind === KindQuestionQuestionToken) {
    leftNode = rustUnparenthesizedExpression(walk.context.ast, leftNode);
    rightNode = rustUnparenthesizedExpression(walk.context.ast, rightNode);
  }
  if (operatorKind === KindQuestionQuestionEqualsToken) {
    const target = assignmentTarget(walk.context.ast, leftNode);
    const left = resolveExpressionCarrierBeforeFlowReadProjection(walk, target, sourceFile, undefined);
    const location = walk.context.facts.getFact(target, rustTargetOperationFactKey);
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
    operatorKind === KindQuestionQuestionToken
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
    ? isRustOptionCarrier(left) ? rustOptionValueCarrier(left) : expected
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
        contextualLiteralOperandCarrier(walk.context.ast, leftNode, right),
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
        contextualLiteralOperandCarrier(walk.context.ast, rightNode, left),
      ),
    };
  }
  return {
    left: resolveExpressionCarrier(walk, leftNode, sourceFile, undefined),
    right: resolveExpressionCarrier(walk, rightNode, sourceFile, undefined),
  };
}

function contextualLiteralOperandCarrier(
  ast: AstReader,
  expression: Node,
  counterpart: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (isRustNullishSourceCarrier(counterpart) || counterpart?.kind === "type-parameter") return undefined;
  const kind = ast.kindName(expression);
  if (kind === KindPrefixUnaryExpression || kind === KindParenthesizedExpression) {
    const operand = kind === KindPrefixUnaryExpression ? Node_Operand(ast, expression) : Node_Expression(ast, expression);
    return operand === undefined ? undefined : contextualLiteralOperandCarrier(ast, operand, counterpart);
  }
  if (kind === KindNumericLiteral && isRustBigIntCarrier(counterpart) ||
    kind === KindBigIntLiteral && isRustNumericCarrier(counterpart) &&
      (counterpart.name === "float64" || counterpart.name === "float32")) return undefined;
  return counterpart;
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
  const { left, right, leftNode, rightNode, operatorKind } = operands;
  const location = operatorKind === KindQuestionQuestionEqualsToken ? assignmentTarget(walk.context.ast, leftNode) : leftNode;
  const selectedLeftOperation = walk.context.facts.get(location, rustSelectedOperationKey) ??
    walk.context.facts.resolve(location, rustSelectedOperationKey);
  const selectedLeftFact = walk.context.facts.get(location, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(location, rustTargetOperationFactKey);
  const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
    operatorKind === KindExclamationEqualsEqualsToken;
  const leftComparisonCarrier = strictEquality
    ? strictEqualityOperandCarrier(walk, operands.leftNode, left)
    : left;
  const rightComparisonCarrier = strictEquality
    ? strictEqualityOperandCarrier(walk, operands.rightNode, right)
    : right;
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
  const leftOptionDepth = strictEquality && isRustOptionCarrier(leftComparisonCarrier)
    ? rustOptionNestingDepth(leftComparisonCarrier, rightComparisonCarrier) : undefined;
  const rightOptionDepth = strictEquality && isRustOptionCarrier(rightComparisonCarrier)
    ? rustOptionNestingDepth(rightComparisonCarrier, leftComparisonCarrier) : undefined;
  const optionValueOperand = leftOptionDepth !== undefined && leftOptionDepth > 0
    ? "left" as const
    : rightOptionDepth !== undefined && rightOptionDepth > 0
      ? "right" as const
      : undefined;
  const errorEquality = strictEquality
    ? selectRustProgramErrorEquality(walk, left, right, operatorKind === KindExclamationEqualsEqualsToken)
    : undefined;
  let fact: RustTargetOperationFact | undefined;
  if (errorEquality !== undefined) {
    fact = errorEquality;
  } else if (operatorKind === KindQuestionQuestionEqualsToken && left !== undefined && right !== undefined &&
    (walk.context.ast.kindName(location) === KindIdentifier && selectedLeftOperation === undefined ||
      selectedLeftFact?.kind === "source-field" || selectedLeftFact?.kind === "source-accessor" ||
      selectedLeftFact?.kind === "source-static-field") &&
    (selectedLeftOperation === undefined || rustTargetOperationSupportsAssignment(selectedLeftFact))) {
    const rightValue = rustValueCarrierBeforeContextualConversion(walk.context.facts, rightNode);
    const inner = rustOptionElementCarrier(left);
    const storage = selectedLeftFact?.kind === "source-accessor" ? selectedLeftFact.write?.valueCarrier : left;
    const presentResult = inner !== undefined && rustTargetTypeRefEquals(inner, rightValue)
      ? "value"
      : inner !== undefined && rustTargetTypeRefEquals(left, rightValue)
        ? "option"
        : inner === undefined && !isRustNullishSourceCarrier(left) && rustTargetTypeRefEquals(left, rightValue)
          ? "identity"
          : undefined;
    if (presentResult !== undefined && rightValue !== undefined && storage !== undefined &&
      rustTargetTypeRefEquals(storage, right)) {
      fact = {
        kind: "nullish-assignment",
        operationId: "tsonic.rust.assignment.nullish",
        readCarrier: left,
        rightCarrier: rightValue,
        presentResult,
        assignment: {
          kind: "operator-token",
          operationId: "tsonic.rust.assignment.nullish.write",
          operator: "=",
          resultCarrier: storage,
        },
        resultCarrier: presentResult === "value" ? inner! : left,
      };
    }
  } else if (operatorKind === KindQuestionQuestionToken) {
    const inner = isRustOptionCarrier(left) ? rustOptionValueCarrier(left) : undefined;
    const leftOptionDepth = rustOptionNestingDepth(left, inner);
    if (inner !== undefined && right !== undefined &&
      leftOptionDepth !== undefined && (rustTargetTypeRefEquals(inner, right) || isRustNeverCarrier(right))) {
      fact = {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce",
        leftOptionDepth,
        rightOptionDepth: 0,
        rightValueForm: "value",
        resultCarrier: inner,
      };
    } else if (inner !== undefined && right !== undefined && leftOptionDepth !== undefined &&
      isRustOptionCarrier(right) && rustTargetTypeRefEquals(inner, rustOptionValueCarrier(right))) {
      const rawRight = walk.context.facts.getRuntimeCarrierFact(rightNode)?.carrier;
      const rawDepth = isRustOptionCarrier(rawRight) ? rustOptionNestingDepth(rawRight, inner) : undefined;
      fact = {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce-option",
        leftOptionDepth,
        rightOptionDepth: rawDepth ?? rustOptionNestingDepth(right, inner)!,
        rightValueForm: rawDepth === undefined ? "value" : "raw",
        resultCarrier: rustOptionTargetType(inner),
      };
    } else if (inner !== undefined && isRustDefinitelyNullishCarrier(right) && leftOptionDepth !== undefined) {
      const resultCarrier = rustOptionTargetType(inner);
      const fallback = resolveExpressionCarrier(walk, rightNode, sourceFile, resultCarrier);
      if (rustTargetTypeRefEquals(fallback, resultCarrier)) {
        fact = {
          kind: "option-coalesce",
          operationId: "tsonic.rust.option.coalesce-option",
          leftOptionDepth,
          rightOptionDepth: 1,
          rightValueForm: "value",
          resultCarrier,
        };
      }
    } else if (left !== undefined && right !== undefined &&
      (rustTargetTypeRefEquals(left, right) || isRustNeverCarrier(right)) &&
      !isRustOptionCarrier(left) && !isRustNullishSourceCarrier(left) &&
      rustRuntimeUnionContract(left)?.alternatives.some(alternative =>
        isRustDefinitelyNullishCarrier(alternative.carrier)) !== true) {
      fact = {
        kind: "nullish-identity",
        operationId: "tsonic.rust.nullish.identity",
        resultCarrier: left,
      };
    }
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    optionNullishRelationship !== undefined && optionNullishRelationship.depths.length > 0 &&
    optionNullishOperand !== undefined && optionNullishCarrier !== undefined &&
    comparedNullishCarrier !== undefined) {
    fact = {
      kind: "option-check",
      operationId: (operatorKind === KindExclamationEqualsEqualsToken) !== optionNullishRelationship.negated
        ? "tsonic.rust.option.is-some"
        : "tsonic.rust.option.is-none",
      negated: (operatorKind === KindExclamationEqualsEqualsToken) !== optionNullishRelationship.negated,
      optionOperand: optionNullishOperand,
      optionCarrier: optionNullishCarrier,
      nullishCarrier: comparedNullishCarrier,
      nullishDepths: optionNullishRelationship.depths,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    optionNullishRelationship?.depths.length === 0) {
    fact = {
      kind: "constant-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.equality.option-nullish-constant.not-equal"
        : "tsonic.rust.equality.option-nullish-constant.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: (operatorKind === KindExclamationEqualsEqualsToken) !== optionNullishRelationship.negated,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken ||
      operatorKind === "KindEqualsEqualsToken" || operatorKind === "KindExclamationEqualsToken") &&
    isRustDefinitelyNullishCarrier(left) && isRustDefinitelyNullishCarrier(right)) {
    const equal = operatorKind === "KindEqualsEqualsToken" || operatorKind === "KindExclamationEqualsToken" ||
      rustTargetTypeRefEquals(left, right);
    const negated = operatorKind === KindExclamationEqualsEqualsToken || operatorKind === "KindExclamationEqualsToken";
    fact = {
      kind: "constant-equality",
      operationId: negated
        ? "tsonic.rust.equality.nullish.not-equal"
        : "tsonic.rust.equality.nullish.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: negated ? !equal : equal,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    ((isRustDefinitelyNullishCarrier(left) && right !== undefined &&
        !isRustDefinitelyNullishCarrier(right) && !isRustOptionCarrier(right) &&
        left !== undefined && rustRuntimeUnionProjection(right, left) === undefined) ||
      (isRustDefinitelyNullishCarrier(right) && left !== undefined &&
        !isRustDefinitelyNullishCarrier(left) && !isRustOptionCarrier(left) &&
        right !== undefined && rustRuntimeUnionProjection(left, right) === undefined))) {
    fact = {
      kind: "constant-equality",
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
    const parent = walk.context.ast.parent(expression);
    const equivalentOperator = parent !== undefined &&
        walk.context.ast.kindName(parent) === KindExpressionStatement
      ? selectEquivalentBindingAssignment(walk, leftNode, operands.rightNode, left)
      : undefined;
    fact = {
      kind: "operator-token",
      operationId: equivalentOperator === undefined
        ? `tsonic.rust.operator.=.${rustOperatorCarrierKey(right)}`
        : `tsonic.rust.operator.${equivalentOperator}.equivalent.${rustOperatorCarrierKey(right)}`,
      operator: equivalentOperator ?? "=",
      resultCarrier: rustValueCarrierBeforeOptionProjection(walk.context.facts, operands.rightNode) ?? right,
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
      const binary = selectRustBinaryOperator(operatorKind, left, right) ??
        selectRustGenericNumericOperation(walk, expression, operatorKind, leftNode, rightNode, left, right);
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
  if ((fact.kind === "operator-token" || fact.kind === "operator-call") &&
    fact.operator !== "=" && isRustAssignmentOperator(fact.operator)) {
    recordRustCompoundWrite(walk, expression, leftNode, resultCarrier);
  }
  return setCarrierFact(walk, expression, resultCarrier);
}

function assignmentTarget(ast: AstReader, expression: Node): Node {
  let target = expression;
  while (ast.kindName(target) === KindParenthesizedExpression) {
    const inner = Node_Expression(ast, target);
    if (inner === undefined) break;
    target = inner;
  }
  return target;
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
  if (!isRustNumericCarrier(expected) && !isRustBigIntCarrier(expected)) {
    expected = operand !== undefined && walk.context.ast.kindName(operand) === KindBigIntLiteral
      ? rustBigIntTargetType()
      : rustSourcePrimitiveTargetType("float64");
  }
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
