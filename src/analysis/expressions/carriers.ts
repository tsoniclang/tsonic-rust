import { requireRustRecord } from "../program/records/required-records.js";
import {
  ElementAccessExpression_ArgumentExpression,
  BinaryExpression_Left,
  BinaryExpression_Right,
  BinaryExpression_OperatorToken,
  Node_Operand,
  KindBinaryExpression,
  KindCallExpression,
  KindConditionalExpression,
  KindDeleteExpression,
  KindElementAccessExpression,
  KindEqualsToken,
  KindIdentifier,
  KindNewExpression,
  KindNonNullExpression,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindQuestionQuestionToken,
  KindSatisfiesExpression,
  KindSpreadElement,
  sourceSequenceInputChoice,
  sourceSequenceInputIsEmpty,
  KindVoidExpression,
  KindAwaitExpression,
  Node_Expression,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  isRustUnitCarrier,
  isRustBigIntCarrier,
  isRustNumericCarrier,
  isRustOptionCarrier,
  rustOptionElementCarrier,
  rustSourcePrimitiveTargetType,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";
import { rustSourceValueWrapperContains } from "../../policy/ownership/source-value-wrappers.js";
import { selectRustIntegerTruncationConversion } from "../../policy/conversions/integer-truncation.js";
import { selectRustKnownNumericValueConversion } from "../../policy/conversions/selection.js";

import { selectRustValueCarrierReconciliation } from "../../policy/types/resolution/value-carrier-reconciliation.js";
import { recordRustConversionSelection, recordRustOptionProjection, recordRustValueCarrierReconciliation } from "../conversions/value-carrier-queries.js";

import { rustPostCheckOperationKind } from "../../target-model/operations/model.js";
import { rustTargetOperationResultCarrier } from "../../target-model/records/operations.js";
import { appendRustDiagnostic, rustOperationContext, rustResolutionContext, selectExpressionOperation } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";
import { selectedSourceLiteralIsRepresentable } from "../../policy/types/resolution/selected-numeric-literal.js";
import { selectProviderRecordArgument } from "../operations/provider/calls/record-arguments.js";
import { selectRustExactIntegerConversion } from "../../target-model/conversions/exact-integer.js";
import { selectRustGuardedIntegerConversion } from "../../policy/conversions/integer-refinement.js";
import { isRustAssignmentOperator, isRustNumericBinaryOperator } from "../../policy/operations/operators/rules.js";
import { recordAssignmentWrite } from "../declarations/types-and-bindings.js";
import { recordSelectedOperationInputs } from "../operations/inputs.js";
import { resolveBinaryOperandCarriers } from "../operations/operators.js";
import { resolveExpressionCarrierUncached } from "./value-resolution.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { recordRustCompoundWrite } from "../operations/provider/compound-writes.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { readRustSourceRawAddress } from "../../policy/operations/pointers/raw-addresses.js";
import { readRustRawLocation } from "../../policy/operations/pointers/native-memory.js";
import { selectRustMemoryLayoutObservation } from "../../policy/operations/pointers/layout-observations.js";
import { selectTsonicMemoryFieldBinding, selectTsonicMemoryRecordBinding } from "@tsonic/source-core/facts";
import { applyFlowReadLane } from "./flow-read.js";
import { resolveNativeProviderCallableArguments } from "../operations/provider/calls/native-callables.js";
import { selectRustUnionVariantByCheckedType } from "./union-context.js";

export function resolveExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  purpose: "value" | "operation" = "value",
  integerConversion: "native" | "exact" = "native",
): TargetTypeRef | undefined {
  walk.context.records.assertOpen();
  if (walk.rejectedExpressions.has(expression)) return undefined;
  const records = walk.context.records;
  const contextualExpected = rustExpressionResolutionExpectation(
    walk,
    expression,
    expected,
  );
  const finalize = (carrier: TargetTypeRef | undefined): TargetTypeRef | undefined => {
    const retainParameterAbi = (result: TargetTypeRef | undefined): TargetTypeRef | undefined => {
      const operand = Node_Expression(walk.context.ast, expression);
      if (result !== undefined && operand !== undefined &&
        rustSourceValueWrapperContains(expression, operand, walk.context.ast)) {
        const abi = records.sourceParameterAbi.get(operand);
        if (abi !== undefined && rustTargetTypeRefEquals(result, abi.valueCarrier)) {
          requireRustRecord(walk.context.requiredRecords, "sourceParameterAbi", expression, "parameter-wrapper", "resolveExpressionCarrier");
          records.sourceParameterAbis.use(expression, operand);
        }
      }
      return result;
    };
    if (purpose === "operation") {
      const refinement = walk.context.source.semantics.selectValueTypeRefinement(expression);
      return retainParameterAbi(refinement.kind === "resolved" && refinement.refinement.kind === "members"
        ? applyFlowReadLane(walk, expression, carrier)
        : carrier);
    }
    const selectedOperation = records.selectedOperation.get(expression);
    const targetOperation = records.targetOperation.get(expression);
    const selectedOperationOwnsResult = selectedOperation !== undefined || targetOperation !== undefined;
    const flowCarrier = selectedOperationOwnsResult &&
        (rustTargetTypeRefEquals(carrier, expected) ||
          rustOptionElementCarrier(carrier) === undefined &&
          (carrier === undefined || rustUnionAlternatives(carrier, walk.context.typeDefinitions) === undefined))
      ? carrier
      : applyFlowReadLane(walk, expression, carrier);
    return retainParameterAbi(applyOptionLane(walk, expression, flowCarrier, expected, integerConversion));
  };
  const existing = records.runtimeCarrier.get(expression) ??
    walk.context.records.runtimeCarrier.get(expression);
  if (walk.resolving.has(expression)) {
    return existing === undefined
      ? undefined
      : finalize(existing.carrier);
  }
  walk.resolving.add(expression);
  try {
    if (walk.context.ast.kindName(expression) === "KindClassExpression") {
      return finalize(walk.context.records.classValues.resolve(walk, expression, contextualExpected));
    }
    if (existing !== undefined) {
      let operation = records.targetOperation.get(expression) ??
        walk.context.records.targetOperation.get(expression);
      const expressionKind = walk.context.ast.kindName(expression);
      if (expressionKind === KindIdentifier && rustStructuralObjectCarrierValue(existing.carrier) !== undefined) {
        const classValue = walk.context.records.classValues.resolve(walk, expression, contextualExpected ?? existing.carrier);
        if (classValue !== undefined) return finalize(classValue);
      }
      if ((expressionKind === "KindArrowFunction" || expressionKind === "KindFunctionExpression") &&
        operation?.kind !== "closure") {
        const callableCarrier = resolveExpressionCarrierUncached(
          walk,
          expression,
          sourceFile,
          contextualExpected ?? existing.carrier,
          purpose,
        );
        if (callableCarrier === undefined ||
          !rustTargetTypeRefEquals(callableCarrier, existing.carrier)) {
          return undefined;
        }
        operation = records.targetOperation.get(expression) ??
          walk.context.records.targetOperation.get(expression);
      }
      recordSelectedOperationInputs(walk, expression, sourceFile, operation);
      return finalize(existing.carrier);
    }
    const expressionKind = walk.context.ast.kindName(expression);
    if (expressionIsPlainAssignment(walk.context.ast, expression)) {
      const target = BinaryExpression_Left(walk.context.ast, expression);
      if (target !== undefined) {
        resolveExpressionCarrier(walk, target, sourceFile, undefined);
      }
      const value = BinaryExpression_Right(walk.context.ast, expression);
      if (value !== undefined) resolveIndependentValueOperation(walk, value, sourceFile);
      selectExpressionOperation(walk, expression, sourceFile);
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
    } else if (expressionKind === KindCallExpression || expressionKind === KindNewExpression) {
      resolveCallSelectionPrerequisites(walk, expression, sourceFile);
      selectExpressionOperation(walk, expression, sourceFile);
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
    } else {
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
      selectExpressionOperation(walk, expression, sourceFile);
    }
    const selectedCarrier = records.runtimeCarrier.get(expression) ??
      walk.context.records.runtimeCarrier.get(expression);
    if (selectedCarrier !== undefined) {
      const operation = records.targetOperation.get(expression) ??
        walk.context.records.targetOperation.get(expression);
      recordSelectedOperationInputs(
        walk,
        expression,
        sourceFile,
        operation,
      );
      return finalize(selectedCarrier.carrier);
    }
    const selectedOperation = records.selectedOperation.get(expression) ??
      walk.context.records.selectedOperation.get(expression);
    if (selectedOperation !== undefined) {
      const rustOperation = records.targetOperation.get(expression) ??
        walk.context.records.targetOperation.get(expression);
      const optionalChain = records.optionalChain.get(expression) ??
        walk.context.records.optionalChain.get(expression);
      if (optionalChain !== undefined && selectedOperation.resultType !== undefined &&
        !rustTargetTypeRefEquals(optionalChain.resultCarrier, selectedOperation.resultType)) {
        appendRustDiagnostic(
          walk,
          "RUST_OPTIONAL_CHAIN_RESULT_CONFLICT",
          "The finalized optional-chain result conflicts with the selected Rust operation result.",
          expression,
          ["target.capability=rust.optional-chain.exact-result"],
        );
        return undefined;
      }
      const finalizedResult = optionalChain?.resultCarrier ?? (rustOperation === undefined
        ? selectedOperation.resultType
        : rustTargetOperationResultCarrier(rustOperation) ?? selectedOperation.resultType);
      const expressionKind = walk.context.ast.kindName(expression);
      const sourceCallNeedsLifecycle = finalizedResult === undefined && rustOperation === undefined &&
        (expressionKind === KindCallExpression || expressionKind === KindNewExpression);
      if (!sourceCallNeedsLifecycle &&
        (finalizedResult !== undefined || rustPostCheckOperationKind(selectedOperation.operationId) === undefined)) {
        recordSelectedOperationInputs(
          walk,
          expression,
          sourceFile,
          rustOperation,
        );
        return finalizedResult === undefined
          ? undefined
          : finalize(setCarrierFact(walk, expression, finalizedResult));
      }
    }
    const resolved = resolveExpressionCarrierUncached(
      walk,
      expression,
      sourceFile,
      contextualExpected,
      purpose,
    );
    return finalize(resolved);
  } finally {
    recordExpressionBindingEffects(walk, expression);
    walk.resolving.delete(expression);
  }
}

export function resolveExpressionCarrierBeforeFlowReadProjection(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const resolved = resolveExpressionCarrier(walk, expression, sourceFile, expected);
  return walk.context.records.runtimeCarrier.get(expression)?.carrier ?? resolved;
}

function rustExpressionResolutionExpectation(
  walk: RustFactWalk,
  expression: Node,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindParenthesizedExpression ||
    kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    return expected;
  }
  const present = isRustOptionCarrier(expected) ? rustOptionElementCarrier(expected) : expected;
  const union = present === undefined ? undefined : walk.sourceTypes.sourceUnionForCarrier(present);
  if (kind === KindConditionalExpression) {
    return union === undefined ? expected
      : selectRustUnionVariantByCheckedType(walk, expression, union)?.carrier ?? expected;
  }
  return union !== undefined && (ast.is.IsArrowFunction(expression) || ast.is.IsFunctionExpression(expression) ||
    ast.is.IsArrayLiteralExpression(expression) || ast.is.IsObjectLiteralExpression(expression))
    ? selectRustUnionVariantByCheckedType(walk, expression, union)?.carrier
    : present;
}

function expressionIsPlainAssignment(ast: AstReader, expression: Node): boolean {
  if (ast.kindName(expression) !== KindBinaryExpression) {
    return false;
  }
  const operator = BinaryExpression_OperatorToken(ast, expression);
  return operator !== undefined && ast.kindName(operator) === KindEqualsToken;
}

function recordExpressionBindingEffects(walk: RustFactWalk, expression: Node): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(ast, expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    if (isRustAssignmentOperator(operatorKind)) {
      recordAssignmentWrite(walk, expression, BinaryExpression_Left(ast, expression));
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const fact = walk.context.records.targetOperation.get(expression);
    if (fact?.kind === "operator-token" && (fact.operator === "+=" || fact.operator === "-=")) {
      const operand = Node_Operand(ast, expression);
      if (operand !== undefined) recordRustCompoundWrite(walk, expression, operand, fact.resultCarrier);
      recordAssignmentWrite(walk, expression, operand);
    }
  }
}

function resolveExpressionOperationDependencies(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    resolveBinaryOperandCarriers(walk, expression, sourceFile, expected, true);
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(ast, expression);
    if (operand !== undefined) {
      const numericUnary = ast.operatorKindName(expression) === "KindMinusToken" ||
        ast.operatorKindName(expression) === "KindPlusToken";
      const checkedFloat = numericUnary &&
        walk.context.literalValues.literalValue.get(expression)?.numeric?.kind === "checked-float64";
      const operandExpected = checkedFloat ? rustSourcePrimitiveTargetType("float64")
        : numericUnary && !isRustNumericCarrier(expected) && !isRustBigIntCarrier(expected) ? undefined : expected;
      resolveExpressionCarrier(walk, operand, sourceFile, operandExpected);
    }
    return;
  }
  if (kind === KindVoidExpression || kind === KindAwaitExpression) {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindDeleteExpression) {
    const operand = Node_Expression(ast, expression);
    const receiver = operand === undefined ? undefined : Node_Expression(ast, operand);
    const index = operand === undefined
      ? undefined
      : ElementAccessExpression_ArgumentExpression(ast, operand);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (index !== undefined) {
      resolveExpressionCarrier(
        walk,
        index,
        sourceFile,
        undefined,
      );
    }
    return;
  }
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const receiver = Node_Expression(ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (kind === KindElementAccessExpression) {
      const argument = ElementAccessExpression_ArgumentExpression(ast, expression);
      if (argument !== undefined) {
        resolveCallArgumentOperationPrerequisite(walk, argument, sourceFile);
      }
    }
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      const asserted = ast.isConstAssertion(expression) ? expected : resolveRustTargetTypeRef(
        Node_Type(ast, expression), rustResolutionContext(walk, expression), walk.operationOptions);
      const literalExpected = asserted?.kind === "source-primitive" &&
        selectedSourceLiteralIsRepresentable(walk.context.literalValues.literalValue.get(operand), asserted.name) ? asserted : undefined;
      resolveExpressionCarrier(walk, operand, sourceFile, ast.isConstAssertion(expression) ? expected : literalExpected);
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    return;
  }
}

function resolveCallArgumentOperationPrerequisite(
  walk: RustFactWalk,
  argument: Node,
  sourceFile: SourceFile,
): void {
  const kind = walk.context.ast.kindName(argument);
  const refinement = walk.context.source.semantics.selectValueTypeRefinement(argument);
  if (refinement.kind === "resolved") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindIdentifier || kind === KindCallExpression || kind === KindNewExpression ||
    kind === "KindRegularExpressionLiteral" ||
    kind === KindPropertyAccessExpression || kind === KindElementAccessExpression ||
    kind === KindBinaryExpression || kind === KindPrefixUnaryExpression ||
    kind === KindPostfixUnaryExpression) {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindNonNullExpression) {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    if (!walk.context.ast.isConstAssertion(argument)) {
      resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    } else {
      const inner = Node_Expression(walk.context.ast, argument);
      if (inner !== undefined) resolveCallArgumentOperationPrerequisite(walk, inner, sourceFile);
    }
    return;
  }
  if (kind === KindParenthesizedExpression || kind === KindSatisfiesExpression) {
    const inner = Node_Expression(walk.context.ast, argument);
    if (inner !== undefined) {
      resolveCallArgumentOperationPrerequisite(walk, inner, sourceFile);
    }
  }
}

function resolveCallSelectionPrerequisites(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): void {
  if (readRustRawLocation(walk.context.ast, walk.context.source.sourceFacts, expression) !== undefined ||
    selectTsonicMemoryFieldBinding(walk.context.ast, walk.context.source.sourceFacts, expression) !== undefined ||
    selectTsonicMemoryRecordBinding(walk.context.ast, walk.context.source.sourceFacts, expression) !== undefined ||
    readRustSourceRawAddress(walk.context.source.sourceFacts, expression) !== undefined ||
    selectRustMemoryLayoutObservation(walk.context.source.sourceFacts, expression) !== undefined) return;
  const source = walk.context.semantics(sourceFile).operations.call(expression);
  const receiver = source?.sourceReceiver?.expression;
  if (receiver !== undefined) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  for (const argument of source?.sourceArguments ?? []) {
    resolveIndependentValueOperation(
      walk,
      argument.expression,
      sourceFile,
    );
  }
  resolveNativeProviderCallableArguments(walk, expression, sourceFile,
    (argument, expected) => resolveExpressionCarrier(walk, argument, sourceFile, expected));
}

function resolveIndependentValueOperation(
  walk: RustFactWalk,
  argument: Node,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(argument);
  if (kind === KindBinaryExpression) {
    const operator = BinaryExpression_OperatorToken(ast, argument);
    if (operator !== undefined && ast.kindName(operator) === KindQuestionQuestionToken) {
      resolveExpressionCarrier(walk, argument, sourceFile, undefined, "operation");
      return;
    }
    if (operator === undefined || !isRustNumericBinaryOperator(ast.kindName(operator))) return;
    const left = BinaryExpression_Left(ast, argument);
    const right = BinaryExpression_Right(ast, argument);
    if (left !== undefined) resolveIndependentValueOperation(walk, left, sourceFile);
    if (right !== undefined) resolveIndependentValueOperation(walk, right, sourceFile);
    const leftCarrier = walk.context.records.runtimeCarrier.get(left)?.carrier;
    const rightCarrier = walk.context.records.runtimeCarrier.get(right)?.carrier;
    if (isRustNumericCarrier(leftCarrier) || isRustNumericCarrier(rightCarrier)) {
      resolveExpressionCarrier(walk, argument, sourceFile, undefined, "operation");
    }
    return;
  }
  if (kind === KindIdentifier || kind === KindCallExpression || kind === KindNewExpression ||
    kind === "KindRegularExpressionLiteral" ||
    kind === KindPropertyAccessExpression || kind === KindElementAccessExpression ||
    kind === KindNonNullExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined, "operation");
    return;
  }
  const unary = kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression;
  if (kind === KindParenthesizedExpression || kind === KindSatisfiesExpression ||
    kind === KindSpreadElement || unary) {
    const inner = unary ? Node_Operand(ast, argument) : Node_Expression(ast, argument);
    if (inner !== undefined) {
      if (kind === KindSpreadElement) {
        const choice = sourceSequenceInputChoice(ast, inner);
        if (choice === undefined) return;
        for (const input of choice.inputs) {
          if (sourceSequenceInputIsEmpty(ast, input)) continue;
          resolveIndependentValueOperation(walk, input, sourceFile);
        }
        return;
      }
      resolveIndependentValueOperation(walk, inner, sourceFile);
      if (walk.context.records.runtimeCarrier.get(inner) !== undefined) {
        resolveExpressionCarrier(walk, argument, sourceFile, undefined, "operation");
      }
    }
  }
}

// Nullish lane: values flow into Option<T> positions through explicit
// Some-wrapping facts; null literals become None.
function applyOptionLane(
  walk: RustFactWalk,
  expression: Node,
  resolved: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  integerConversion: "native" | "exact",
): TargetTypeRef | undefined {
  const expectedOptionElement = rustOptionElementCarrier(expected);
  const target = expected;
  let projected = resolved;
  if (resolved !== undefined && target !== undefined &&
    !rustTargetTypeRefEquals(resolved, target)) {
    const scalarTarget = expectedOptionElement ?? target;
    const retained = walk.context.records.contextualValueConversion.get(expression);
    const refined = selectRustGuardedIntegerConversion({ ast: walk.context.ast, navigation: walk.context.source.navigation,
      sourceFacts: walk.context.source.sourceFacts }, expression, resolved, scalarTarget);
    const exactInteger = refined ?? (integerConversion === "exact"
      ? selectRustExactIntegerConversion(resolved, scalarTarget) : undefined);
    const scalarConversion = selectRustKnownNumericValueConversion(resolved, scalarTarget,
      walk.context.literalValues.literalValue.get(expression)) ?? exactInteger;
    if (scalarConversion !== undefined || retained?.conversion.kind === "exact-integer" &&
      rustTargetTypeRefEquals(retained.sourceCarrier, resolved) &&
      rustTargetTypeRefEquals(retained.targetCarrier, scalarTarget)) {
      recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords, expression, { kind: "conversion", fact: {
        sourceCarrier: resolved, targetCarrier: scalarTarget,
        conversion: scalarConversion ?? retained!.conversion,
      } });
      projected = scalarTarget;
    } else {
      const operation = walk.context.records.targetOperation.get(expression);
      const truncation = selectRustIntegerTruncationConversion(walk.context.ast, expression,
        operation?.kind === "provider-operation" ? operation.operationId : undefined, resolved, scalarTarget);
      if (truncation !== undefined) {
        recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords, expression, { kind: "conversion",
          fact: { sourceCarrier: resolved, targetCarrier: scalarTarget, conversion: truncation } });
        projected = scalarTarget;
      }
      const reconciliationTarget = expectedOptionElement !== undefined && !isRustOptionCarrier(resolved)
        ? scalarTarget : target;
      let reconciliation = truncation === undefined ? selectRustValueCarrierReconciliation(
        resolved,
        reconciliationTarget,
        walk.context.projectTypes, walk.context.typeDefinitions,
      ) : { kind: "identity" as const };
      if (reconciliation.kind === "incompatible" && rustStructuralObjectCarrierValue(resolved) !== undefined) {
        const context = rustOperationContext(walk, expression);
        const conversion = selectProviderRecordArgument(
          context.currentSemantics.types.expressionType(expression),
          context.currentSemantics.types.contextualType(expression),
          resolved, reconciliationTarget, context, walk.operationOptions,
        );
        if (conversion !== undefined) reconciliation = { kind: "conversion", fact: {
          sourceCarrier: resolved, targetCarrier: reconciliationTarget, conversion,
        } };
      }
      if (reconciliation.kind === "incompatible" && reconciliation.reason === "ambiguous") {
        appendRustDiagnostic(
          walk,
          "RUST_PROJECT_UPCAST_AMBIGUOUS",
          "The selected project value has more than one exact target heritage instantiation.",
          expression,
          ["target.capability=rust.project-types.upcast"],
        );
        return undefined;
      }
      if (reconciliation.kind === "call-scoped-lifetime" ||
        reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
        recordRustValueCarrierReconciliation(walk.context.records, walk.context.requiredRecords, expression, reconciliation);
        projected = reconciliationTarget;
        if (reconciliation.kind === "project-upcast" && !isRustOptionCarrier(expected)) {
          recordRustConversionSelection(walk.context.records, walk.context.requiredRecords, expression, reconciliationTarget);
        }
      }
      if (reconciliation.kind === "incompatible" && reconciliation.reason === "unrelated") {
        const view = walk.context.records.objectReferenceViews.select(walk, expression, resolved, reconciliationTarget);
        if (view !== undefined) projected = view.targetCarrier;
      }
    }
  }
  if (expected === undefined || !isRustOptionCarrier(expected)) {
    return projected;
  }
  const inner = rustOptionElementCarrier(expected);
  if (inner === undefined) {
    return resolved;
  }
  if (projected !== undefined && isRustOptionCarrier(projected)) {
    return projected;
  }
  if (isRustUnitCarrier(projected)) {
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "option-none", "applyOptionLane");
    const existing = walk.context.records.targetOperation.get(expression);
    if (existing === undefined) {
      walk.context.records.targetOperations.source(expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    if (projected !== undefined) {
      recordRustOptionProjection(walk.context.records, walk.context.requiredRecords, expression, { kind: "none", sourceCarrier: projected, resultCarrier: expected });
    }
    return expected;
  }
  if (projected !== undefined && rustTargetTypeRefEquals(projected, inner)) {
    recordRustOptionProjection(walk.context.records, walk.context.requiredRecords, expression, { kind: "some", sourceCarrier: projected,
      elementCarrier: inner, resultCarrier: expected });
    return expected;
  }
  return resolved;
}

export function reconcileRequiredCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
): boolean {
  const reconciliation = selectRustValueCarrierReconciliation(
    sourceCarrier,
    targetCarrier,
    walk.context.projectTypes, walk.context.typeDefinitions,
  );
  if (reconciliation.kind === "incompatible") {
    return reconciliation.reason === "unrelated" &&
      walk.context.records.objectReferenceViews.select(walk, expression, sourceCarrier, targetCarrier) !== undefined;
  }
  if (reconciliation.kind === "call-scoped-lifetime" ||
    reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
    recordRustValueCarrierReconciliation(
      walk.context.records, walk.context.requiredRecords,
      expression,
      reconciliation,
    );
  }
  return true;
}
