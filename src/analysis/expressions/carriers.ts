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
  KindSatisfiesExpression,
  KindSpreadElement,
  KindVoidExpression,
  Node_Expression,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  isRustAbsenceCarrier,
  isRustBigIntCarrier,
  isRustNumericCarrier,
  isRustOptionCarrier,
  rustOptionElementCarrier,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import { rustRuntimeUnionContract } from "../../target-model/types/carriers/runtime-unions.js";
import { recordRustObjectReferenceView } from "./object-reference-views.js";
import { selectRustIntegerTruncationConversion } from "../../policy/types/integer-truncation.js";
import { rustContextualValueConversionFactKey } from "../facts/value-projections.js";
import { selectRustValueCarrierReconciliation } from "../../policy/types/value-carrier-reconciliation.js";
import { recordRustValueCarrierReconciliation } from "../facts/value-carrier-queries.js";
import {
  rustOptionalChainFactKey,
  rustOptionProjectionFactKey,
  rustPostCheckOperationKind,
  rustTargetOperationFactKey,
  rustTargetOperationResultCarrier,
} from "../facts/keys.js";
import { appendRustDiagnostic, rustOperationContext, rustResolutionContext, selectExpressionOperation } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { selectedSourceLiteralIsRepresentable } from "../../policy/types/selected-numeric-literal.js";
import { selectProviderRecordArgument } from "../operations/provider/calls/record-arguments.js";
import { selectRustExactIntegerConversion } from "../../target-model/conversions/exact-integer.js";
import { isRustAssignmentOperator, isRustNumericBinaryOperator } from "../../policy/operations/operator-rules.js";
import { recordAssignmentWrite, recordBindingWrite } from "../declarations/types-and-bindings.js";
import { recordSelectedOperationInputs } from "../operations/inputs.js";
import { resolveBinaryOperandCarriers } from "../operations/operators.js";
import { resolveExpressionCarrierUncached } from "./value-resolution.js";
import {
  rustConversionKey,
  rustRuntimeCarrierKey,
  rustSelectedOperationKey,
} from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { recordRustCompoundWrite } from "../operations/provider/compound-writes.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { readRustSourceRawAddress } from "../../policy/operations/raw-address-source.js";
import { readRustRawLocation } from "../../policy/operations/native-memory.js";
import { selectRustMemoryLayoutObservation } from "../../policy/operations/memory-layout.js";
import { resolveRustClassValue } from "../objects/class-values.js";
import { selectTsonicMemoryFieldBinding, selectTsonicMemoryRecordBinding } from "@tsonic/source-core/facts";
import { applyFlowReadLane } from "./flow-read.js";

export function resolveExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  purpose: "value" | "operation" = "value",
  integerConversion: "native" | "exact" = "native",
): TargetTypeRef | undefined {
  if (walk.rejectedExpressions.has(expression)) return undefined;
  const facts = walk.context.facts;
  const contextualExpected = rustExpressionResolutionExpectation(
    walk.context.ast,
    expression,
    expected,
  );
  const finalize = (carrier: TargetTypeRef | undefined): TargetTypeRef | undefined => {
    if (purpose === "operation") {
      const refinement = walk.context.source.semantics.selectValueTypeRefinement(expression);
      return refinement.kind === "resolved" && refinement.refinement.kind === "members"
        ? applyFlowReadLane(walk, expression, carrier)
        : carrier;
    }
    const selectedOperation = facts.get(expression, rustSelectedOperationKey) ??
      facts.resolve(expression, rustSelectedOperationKey);
    const targetOperation = facts.get(expression, rustTargetOperationFactKey) ??
      facts.resolve(expression, rustTargetOperationFactKey);
    const optionalChain = facts.get(expression, rustOptionalChainFactKey) ??
      facts.resolve(expression, rustOptionalChainFactKey);
    const selectedOperationOwnsResult = selectedOperation !== undefined || targetOperation !== undefined;
    const flowCarrier = selectedOperationOwnsResult &&
        (optionalChain !== undefined || rustTargetTypeRefEquals(carrier, expected) ||
          rustOptionElementCarrier(carrier) === undefined &&
          (carrier === undefined || rustRuntimeUnionContract(carrier) === undefined))
      ? carrier
      : applyFlowReadLane(walk, expression, carrier);
    return applyOptionLane(walk, expression, flowCarrier, expected, integerConversion);
  };
  const existing = facts.get(expression, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
  if (walk.resolving.has(expression)) {
    return existing === undefined
      ? undefined
      : finalize(existing.carrier);
  }
  walk.resolving.add(expression);
  try {
    if (walk.context.ast.kindName(expression) === "KindClassExpression") {
      return finalize(resolveRustClassValue(walk, expression, contextualExpected));
    }
    if (existing !== undefined) {
      let operation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      const expressionKind = walk.context.ast.kindName(expression);
      if (expressionKind === KindIdentifier && rustStructuralObjectCarrierValue(existing.carrier) !== undefined) {
        const classValue = resolveRustClassValue(walk, expression, contextualExpected ?? existing.carrier);
        if (classValue !== undefined) return finalize(classValue);
      }
      if ((expressionKind === "KindArrowFunction" || expressionKind === "KindFunctionExpression") &&
        operation?.kind !== "closure") {
        const callableCarrier = resolveExpressionCarrierUncached(
          walk,
          expression,
          sourceFile,
          contextualExpected ?? existing.carrier,
        );
        if (callableCarrier === undefined ||
          !rustTargetTypeRefEquals(callableCarrier, existing.carrier)) {
          return undefined;
        }
        operation = facts.get(expression, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(expression, rustTargetOperationFactKey);
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
    const selectedCarrier = facts.get(expression, rustRuntimeCarrierKey) ??
      walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
    if (selectedCarrier !== undefined) {
      const operation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      recordSelectedOperationInputs(
        walk,
        expression,
        sourceFile,
        operation,
      );
      return finalize(selectedCarrier.carrier);
    }
    const selectedOperation = facts.get(expression, rustSelectedOperationKey) ??
      walk.context.facts.resolve(expression, rustSelectedOperationKey);
    if (selectedOperation !== undefined) {
      const rustOperation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      const optionalChain = facts.get(expression, rustOptionalChainFactKey) ??
        walk.context.facts.resolve(expression, rustOptionalChainFactKey);
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
  return walk.context.facts.getRuntimeCarrierFact(expression)?.carrier ?? resolved;
}

function rustExpressionResolutionExpectation(
  ast: AstReader,
  expression: Node,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (!isRustOptionCarrier(expected)) {
    return expected;
  }
  const kind = ast.kindName(expression);
  if (kind === KindConditionalExpression || kind === KindParenthesizedExpression ||
    kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    return expected;
  }
  return rustOptionElementCarrier(expected);
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
    const fact = walk.context.facts.get(expression, rustTargetOperationFactKey);
    if (fact?.kind === "operator-token" && (fact.operator === "+=" || fact.operator === "-=")) {
      const operand = Node_Operand(ast, expression);
      recordBindingWrite(walk, operand);
      if (operand !== undefined) recordRustCompoundWrite(walk, expression, operand, fact.resultCarrier);
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
      const operandExpected = numericUnary && !isRustNumericCarrier(expected) && !isRustBigIntCarrier(expected)
        ? undefined : expected;
      resolveExpressionCarrier(walk, operand, sourceFile, operandExpected);
    }
    return;
  }
  if (kind === KindVoidExpression) {
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
        selectedSourceLiteralIsRepresentable(operand, asserted.name, ast) ? asserted : undefined;
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
    if (operator === undefined || !isRustNumericBinaryOperator(ast.kindName(operator))) return;
    const left = BinaryExpression_Left(ast, argument);
    const right = BinaryExpression_Right(ast, argument);
    if (left !== undefined) resolveIndependentValueOperation(walk, left, sourceFile);
    if (right !== undefined) resolveIndependentValueOperation(walk, right, sourceFile);
    const leftCarrier = walk.context.facts.getRuntimeCarrierFact(left)?.carrier;
    const rightCarrier = walk.context.facts.getRuntimeCarrierFact(right)?.carrier;
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
  if (kind === KindParenthesizedExpression || kind === KindSatisfiesExpression ||
    kind === KindSpreadElement) {
    const inner = Node_Expression(ast, argument);
    if (inner !== undefined) {
      if (kind === KindSpreadElement && ast.is.IsArrayLiteralExpression(inner) &&
        ast.as.AsArrayLiteralExpression(inner)?.Elements?.Nodes.length === 0) {
        resolveExpressionCarrier(walk, inner, sourceFile, { kind: "tuple", elements: [] });
        return;
      }
      resolveIndependentValueOperation(walk, inner, sourceFile);
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
  const target = expectedOptionElement !== undefined && isRustOptionCarrier(resolved)
    ? expected
    : expectedOptionElement ?? expected;
  let projected = resolved;
  if (resolved !== undefined && target !== undefined &&
    !rustTargetTypeRefEquals(resolved, target)) {
    const retained = walk.context.facts.get(expression, rustContextualValueConversionFactKey);
    const exactInteger = integerConversion === "exact"
      ? selectRustExactIntegerConversion(resolved, target) : undefined;
    if (exactInteger !== undefined || retained?.conversion.kind === "exact-integer" &&
      rustTargetTypeRefEquals(retained.sourceCarrier, resolved) &&
      rustTargetTypeRefEquals(retained.targetCarrier, target)) {
      walk.context.facts.set(expression, rustContextualValueConversionFactKey, {
        sourceCarrier: resolved, targetCarrier: target,
        conversion: { kind: "exact-integer", source: resolved, target },
      }, [{ message: "rust exact native integer storage" }]);
      projected = target;
    } else {
      const operation = walk.context.facts.get(expression, rustTargetOperationFactKey);
      const truncation = selectRustIntegerTruncationConversion(walk.context.ast, expression,
        operation?.kind === "provider-operation" ? operation.operationId : undefined, resolved, target);
      if (truncation !== undefined) {
        walk.context.facts.set(expression, rustContextualValueConversionFactKey, {
          sourceCarrier: resolved, targetCarrier: target, conversion: truncation,
        }, [{ message: "rust exact bounded integer result" }]);
        projected = target;
      }
      let reconciliation = selectRustValueCarrierReconciliation(
        resolved,
        target,
        walk.context.projectTypes, walk.context.typeDefinitions,
      );
      if (reconciliation.kind === "incompatible" && rustStructuralObjectCarrierValue(resolved) !== undefined) {
        const context = rustOperationContext(walk, expression);
        const conversion = selectProviderRecordArgument(
          context.currentSemantics.types.expressionType(expression),
          context.currentSemantics.types.contextualType(expression),
          resolved, target, context, walk.operationOptions,
        );
        if (conversion !== undefined) reconciliation = { kind: "conversion", fact: {
          sourceCarrier: resolved, targetCarrier: target, conversion,
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
        recordRustValueCarrierReconciliation(walk.context.facts, expression, reconciliation);
        projected = target;
        if (reconciliation.kind === "project-upcast" && !isRustOptionCarrier(expected)) {
          walk.context.facts.set(expression, rustConversionKey, { convertedType: target }, [
            { message: "rust project-type upcast conversion" },
          ]);
        }
      }
      if (reconciliation.kind === "incompatible" && reconciliation.reason === "unrelated" &&
        recordRustObjectReferenceView(walk, expression, resolved, target)) projected = target;
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
  if (isRustAbsenceCarrier(projected)) {
    const existing = walk.context.facts.get(expression, rustTargetOperationFactKey);
    if (existing === undefined) {
      setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    if (projected !== undefined) {
      walk.context.facts.set(expression, rustOptionProjectionFactKey, {
        kind: "none",
        sourceCarrier: projected,
        resultCarrier: expected,
      }, [{ message: "rust exact option-none projection" }]);
    }
    return expected;
  }
  if (projected !== undefined && rustTargetTypeRefEquals(projected, inner)) {
    walk.context.facts.set(expression, rustOptionProjectionFactKey, {
      kind: "some",
      sourceCarrier: projected,
      elementCarrier: inner,
      resultCarrier: expected,
    }, [{ message: "rust exact option-some projection" }]);
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
    return reconciliation.reason === "unrelated" && recordRustObjectReferenceView(walk, expression, sourceCarrier, targetCarrier);
  }
  if (reconciliation.kind === "call-scoped-lifetime" ||
    reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
    recordRustValueCarrierReconciliation(
      walk.context.facts,
      expression,
      reconciliation,
    );
  }
  return true;
}
