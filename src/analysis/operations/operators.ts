import { selectRustCompoundAssignmentPromotion } from "../../policy/operations/operators/rules.js";
import { resolveBinaryOperandCarriers, assignmentTarget } from "./operator-inputs.js";
import { selectRustAbsenceComparisonOperation, selectRustCoalesceOperation, selectRustNullishAssignmentOperation } from "../../policy/operations/operators/absence.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import { selectedOptionNullishRelationship } from "../../policy/operations/operators/nullish-comparisons.js";
import { BinaryExpression_Left, Node_Operand, KindBinaryExpression, KindEqualsEqualsEqualsToken, KindEqualsToken, KindExpressionStatement, KindExclamationEqualsEqualsToken, KindIdentifier, KindBigIntLiteral, KindQuestionQuestionToken, KindQuestionQuestionEqualsToken } from "@tsonic/target-api/source";
import { selectRustGenericNumericOperation } from "./numeric/generic.js";
import { selectRustGuardedIntegerOperation } from "../../policy/operations/numeric/guarded.js";
import { selectRustProgramErrorEquality } from "./error-equality.js";
import { selectRustUnionEquality } from "../../policy/operations/operators/union-equality.js";

import { recordRustCompoundWrite, selectRustCompoundWrite } from "./members/compound-writes.js";
import { isRustAssignmentOperator, rustOperatorCarrierKey, selectRustBinaryOperator, selectRustCompoundAssignment, selectRustEquivalentAssignment } from "../../policy/operations/operators/rules.js";
import { isRustBigIntCarrier, isRustAbsenceCarrier, isRustOptionCarrier, isRustStringCarrier, rustSourceOptionalTargetType, rustOptionValueCarrier, rustBigIntTargetType, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import { rustOptionalStorageValue, rustOptionalStorageNestingDepth } from "../../target-model/types/projections.js";

import { rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../../target-model/operations/model.js";
import { rustTargetOperationResultCarrier } from "../../target-model/records/operations/operations.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { parseSourceBigIntLiteral } from "../../source/extension/literals.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";

import { rustTargetOperationSupportsAssignment } from "../../policy/operations/members/native-contracts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableTargetForSourceLifetime } from "../../policy/conversions/value-carrier-reconciliation.js";

import { rustValueCarrierBeforeContextualConversion, rustValueCarrierBeforeOptionProjection, rustStrictEqualityOperandCarrier } from "../conversions/value-carrier-queries.js";

import { isRustNumericLiteralCarrier, selectedSourceLiteralIsRepresentable } from "../../policy/conversions/literals.js";

import { setCarrierFact } from "./project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

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
  const selectedLeftOperation = walk.context.records.selectedOperation.get(location);
  const selectedLeftFact = walk.context.records.targetOperation.get(location);
  const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
    operatorKind === KindExclamationEqualsEqualsToken;
  const leftComparisonCarrier = strictEquality
    ? rustStrictEqualityOperandCarrier(walk.context.records, operands.leftNode)
    : left;
  const rightComparisonCarrier = strictEquality
    ? rustStrictEqualityOperandCarrier(walk.context.records, operands.rightNode)
    : right;
  const optionNullishRelationship = selectedOptionNullishRelationship(
    leftComparisonCarrier,
    rightComparisonCarrier,
  );
  const errorEquality = strictEquality
    ? selectRustProgramErrorEquality(walk, left, right, operatorKind === KindExclamationEqualsEqualsToken)
    : undefined;
  const unionEquality = strictEquality && optionNullishRelationship === undefined && left !== undefined && right !== undefined
    ? selectRustUnionEquality(operatorKind === KindExclamationEqualsEqualsToken ? "!==" : "===", left, right, walk.context.typeDefinitions) : undefined;
  const absenceComparison = selectRustAbsenceComparisonOperation(operatorKind, left, right,
    leftComparisonCarrier, rightComparisonCarrier, optionNullishRelationship);
  let fact: RustTargetOperationFact | undefined;
  if (operatorKind === "KindCommaToken" && left !== undefined && right !== undefined) {
    fact = { kind: "sequence", operationId: "tsonic.rust.expression.sequence",
      leftCarrier: left, rightCarrier: right, resultCarrier: right };
  } else if (errorEquality !== undefined) {
    fact = errorEquality;
  } else if (unionEquality !== undefined && left !== undefined && right !== undefined) {
    fact = { kind: "union-equality", operationId: "tsonic.rust.union.equality",
      leftCarrier: left, rightCarrier: right, resultCarrier: rustSourcePrimitiveTargetType("bool"),
      negated: operatorKind === KindExclamationEqualsEqualsToken, ...unionEquality };
  } else if (operatorKind === KindQuestionQuestionEqualsToken && left !== undefined && right !== undefined &&
    (walk.context.ast.kindName(location) === KindIdentifier && selectedLeftOperation === undefined ||
      selectedLeftFact?.kind === "source-field" || selectedLeftFact?.kind === "source-accessor" ||
      selectedLeftFact?.kind === "source-static-field") &&
    (selectedLeftOperation === undefined || rustTargetOperationSupportsAssignment(selectedLeftFact, walk.context.typeDefinitions))) {
    const projected = rustOptionalStorageValue(left);
    const rightValue = projected === undefined ? rustValueCarrierBeforeContextualConversion(walk.context.records, rightNode) : right;
    const storage = selectedLeftFact?.kind === "source-accessor" ? selectedLeftFact.write?.valueCarrier : left;
    fact = selectRustNullishAssignmentOperation(left, right, rightValue, storage);
  } else if (operatorKind === KindQuestionQuestionToken) {
    const inner = rustOptionalStorageValue(left) ?? (isRustOptionCarrier(left) ? rustOptionValueCarrier(left) : undefined);
    const absenceRight = inner === undefined || !isRustAbsenceCarrier(right) ||
      rustOptionalStorageNestingDepth(left, inner) === undefined ? undefined
      : resolveExpressionCarrier(walk, rightNode, sourceFile, rustSourceOptionalTargetType(inner));
    fact = selectRustCoalesceOperation(left, right, walk.context.records.runtimeCarrier.get(rightNode)?.carrier,
      walk.context.literalValues.literalValue.get(rightNode), absenceRight);
  } else if (absenceComparison !== undefined) {
    fact = absenceComparison;
  } else if (operatorKind === KindEqualsToken &&
    (selectedLeftOperation === undefined || rustTargetOperationSupportsAssignment(selectedLeftFact, walk.context.typeDefinitions)) &&
    left !== undefined && right !== undefined &&
    // A callable target whose lifetime is still a placeholder takes the lifetime of the callable assigned to it, as
    // source-call arguments and runtime callees do.
    rustTargetTypeRefEquals(rustCallableTargetForSourceLifetime(right, left), right)) {
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
      resultCarrier: rustValueCarrierBeforeOptionProjection(walk.context.records, operands.rightNode) ?? right,
      operandModes: ["mut-ref", "value"],
    };
  } else {
    const promoted = selectRustCompoundAssignmentPromotion(operatorKind, left, right);
    const promotedWrite = promoted === undefined ? undefined : selectRustCompoundWrite(walk,
      expression, leftNode, promoted.resultCarrier);
    const acceptedPromotion = promotedWrite?.kind === "accept" && promotedWrite.value.targetFact?.kind === "runtime-set"
      ? promoted : undefined;
    const compound = selectRustCompoundAssignment(operatorKind, left, right, acceptedPromotion);
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
            leftConversion: compound.leftConversion,
            rightConversion: compound.rightConversion,
          }
        : {
            kind: "operator-token",
            operationId: `tsonic.rust.operator.${compound.operator}.${rustOperatorCarrierKey(left)}`,
            operator: compound.operator,
            resultCarrier: compound.resultCarrier,
            operandModes: compound.operandModes,
            leftConversion: compound.leftConversion,
            rightConversion: compound.rightConversion,
          };
    } else {
      const binary = selectRustBinaryOperator(operatorKind, left, right) ??
        selectRustGuardedIntegerOperation({ integerRanges: walk.context.integerRanges }, operatorKind, leftNode, rightNode, left, right) ??
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
              operandModes: binary.operandModes,
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
    requireRustRecord(walk.context.requiredRecords, "mutatedBinding", inPlaceStringAppend.declaration, "string-append", "analysis/operations/operators.ts");
    walk.context.records.mutatedBindings.written(inPlaceStringAppend.declaration);
  }
  if (fact === undefined) {
    walk.postCheckOperations.delete(expression);
    if (operatorKind === KindEqualsToken && selectedLeftOperation !== undefined &&
      !rustTargetOperationSupportsAssignment(selectedLeftFact, walk.context.typeDefinitions)) {
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
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/operations/operators.ts");
  walk.context.records.targetOperations.source(expression, fact);
  requireRustRecord(walk.context.requiredRecords, "selectedOperation", expression, fact.kind, "resolvePostCheckBinaryCarrier");
  walk.context.records.selectedOperations.operator(expression, fact, resultCarrier);
  if ((fact.kind === "operator-token" || fact.kind === "operator-call") &&
    fact.operator !== "=" && isRustAssignmentOperator(fact.operator)) {
    recordRustCompoundWrite(walk, expression, leftNode, resultCarrier);
  }
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
  target = assignmentTarget(walk.context.ast, target);
  if (walk.context.ast.kindName(target) !== KindIdentifier) {
    return undefined;
  }
  const reference = walk.context.source.navigation.sourceReferenceFor(target);
  const effects = walk.context.source.navigation.expressionEffects(value);
  const pure = !effects.invokes && !effects.mutates && !effects.suspends && !effects.mayThrow;
  if (reference === undefined || reference.symbol === undefined ||
    walk.context.records.moduleBinding.get(reference.declaration) !== undefined ||
    walk.context.records.bindingStorage.get(reference.declaration) !== undefined ||
    walk.context.source.navigation.declarationUseSummary(reference.declaration).captured && !pure ||
    walk.context.source.navigation.referencesWithin(reference.symbol, value).length !== 0) {
    return undefined;
  }
  return {
    declaration: reference.declaration,
    writeStrategy: pure
      ? "in-place-string-append-parts"
      : "in-place-string-append-value",
  };
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
  const valueFact = walk.context.records.targetOperation.get(value);
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
  if (walk.context.literalValues.literalValue.get(expression)?.numeric?.kind === "checked-float64") {
    expected = rustSourcePrimitiveTargetType("float64");
  }
  if (!isRustNumericLiteralCarrier(expected) && !isRustBigIntCarrier(expected)) {
    expected = operand !== undefined && walk.context.ast.kindName(operand) === KindBigIntLiteral
      ? rustBigIntTargetType()
      : rustSourcePrimitiveTargetType("float64");
  }
  const fixedWidthLiteral = expected?.kind === "source-primitive" &&
    isRustNumericLiteralCarrier(expected) &&
    selectedSourceLiteralIsRepresentable(walk.context.literalValues.literalValue.get(expression), expected.name);
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
        operandModes: ["value"],
      }
    : {
        kind: "source-conversion",
        operationId: rustPostCheckUnaryPlusOperationId,
        resultCarrier: expected,
      };
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/operations/operators.ts");
  walk.context.records.targetOperations.source(expression, fact);
  requireRustRecord(walk.context.requiredRecords, "selectedOperation", expression, fact.kind, "resolvePostCheckUnaryCarrier");
  walk.context.records.selectedOperations.operator(expression, fact, expected);
  return setCarrierFact(walk, expression, expected);
}
