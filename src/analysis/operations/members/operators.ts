import { selectRustCheckedUnaryOperation } from "../../../policy/operations/operators/unary-values.js";
import { mapSelectedAssignment } from "./assignments.js";
import { acceptPostCheckOperator } from "../../program/records/operations/selected-operation-values.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { isRustProgramErrorCarrier, isRustAbsenceCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";

import { isDeclarationFileSubject, rejectSelectedOperation } from "./result.js";

import { acceptDeclarationOperation, acceptRustOperation } from "../../program/records/operations/selected-operation-values.js";
import { normalizeSelectedLiteralCarrier } from "../../source-evidence/types/resolution/selected-literals.js";

import { asNode } from "../../../policy/identities/selected-source.js";

import { KindBigIntLiteral, sourceSequenceInputIsEmpty } from "@tsonic/target-api/source";

import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { resolveRustExactNullishValueCarrier } from "../../source-evidence/types/resolution/target.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";

import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";

import { selectedValueCarrier } from "../selected-values.js";

import { selectRustBuiltinErrorTypeTest } from "./builtin-errors.js";
import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";
import { selectRustClosedTypeTest } from "./type-tests.js";
import { selectRustProjectTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";
import type { RustCheckedCallSelectionInput, RustCheckedOperationSelectionResult, RustCheckedOperatorSelectionInput, RustPolicySelection } from "../../../policy/model/contracts.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";

import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../../target-model/types/carriers/source-error.js";

export function selectRustCheckedOperator(
  request: RustCheckedOperatorSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("operator");
  }
  if (request.operator === "instanceof") {
    return selectRustBuiltinErrorTypeTest(request, context, options) ??
      selectRustProjectTypeTest(request, context, options);
  }
  if (request.right !== undefined) {
    if (request.operator !== "=") {
      return acceptPostCheckOperator(request);
    }
    let left = resolveRustTargetTypeRef(request.left, context, options);
    let right = resolveRustTargetTypeRef(request.right, context, options);
    if (isRustAbsenceCarrier(right)) {
      const rightNode = asNode(request.right, context);
      const rightType = rightNode === undefined
        ? undefined
        : context.currentSemantics.types.expressionType(rightNode);
      if (rightType !== undefined && !context.currentSemantics.types.isUnion(rightType)) {
        right = resolveRustExactNullishValueCarrier(rightType, context.currentSemantics);
      }
    }
    left = normalizeSelectedLiteralCarrier(request.left, left, right, context, options);
    right = normalizeSelectedLiteralCarrier(request.right, right, left, context, options);
    const selectedSet = mapSelectedAssignment(request, left, right, context, options);
    if (selectedSet !== undefined) {
      return selectedSet;
    }
    return acceptPostCheckOperator(request);
  }
  const operand = rustEffectiveValueCarrier(context.records, request.left) ??
    resolveRustTargetTypeRef(request.left, context, options);
  return mapSelectedUnaryOperator(request, operand, context);
}

function selectRustProjectTypeTest(
  request: RustCheckedOperatorSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const sourceCarrier = rustEffectiveValueCarrier(context.records, request.left) ??
    resolveRustTargetTypeRef(request.left, context, options);
  const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const sourceDefinition = options.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = options.projectTypes.definitionForDeclaration(request.sourceRightDeclaration);
  const targetCarrier = targetDefinition === undefined || targetDefinition.kind !== "class" ||
      targetDefinition.genericParameters.length !== 0
    ? undefined
    : options.projectTypes.openCarrier(targetDefinition);
  const programErrorVariant = targetDefinition === undefined
    ? undefined
    : options.projectTypes.programErrorVariant(targetDefinition);
  if (sourceCarrier !== undefined && (isRustProgramErrorCarrier(dispatchCarrier) ||
    (isRustSourceErrorCarrier(dispatchCarrier) || isRustRetainedErrorCarrier(dispatchCarrier) || isRustClosedValueCarrier(dispatchCarrier)) &&
    targetDefinition !== undefined && options.projectTypes.sourceErrorDefinitions.includes(targetDefinition)) &&
    targetCarrier !== undefined && programErrorVariant !== undefined &&
    targetDefinition !== undefined && options.projectTypes.sourceErrorDefinitions.includes(targetDefinition)) {
    const resultCarrier = rustSourcePrimitiveTargetType("bool");
    const fact: RustTargetOperationFact = {
      kind: "program-error-type-test",
      operationId: `tsonic.rust.program-error-type-test.${programErrorVariant}`,
      sourceCarrier,
      targetCarrier,
      variant: programErrorVariant,
      resultCarrier,
    };
    return acceptRustOperation(fact, {
      sourceExpression: request.expression,
      sourceReceiver: request.left,
      sourceSelectedDeclaration: request.sourceRightDeclaration,
    }, resultCarrier);
  }
  if (sourceCarrier === undefined || dispatchCarrier === undefined ||
    sourceDefinition === undefined && !isRustClosedValueCarrier(dispatchCarrier) && !isRustProgramErrorCarrier(dispatchCarrier) ||
    targetDefinition === undefined || targetCarrier === undefined) {
    const closed = sourceCarrier === undefined ? undefined : selectRustClosedTypeTest(request, sourceCarrier, context, options);
    if (closed !== undefined) return closed;
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_TYPE_TEST_EVIDENCE_MISSING",
      "Checked instanceof requires exact project source, concrete class declaration, and closed target carrier evidence.",
    );
  }
  const plan = selectRustProjectTypeTestPlan(sourceCarrier, targetCarrier, options.projectTypes);
  if (plan === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_PROJECT_TYPE_TEST_ROUTE_MISSING",
      "Checked instanceof requires an unambiguous closed generated project downcast route.");
  }
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  const fact: RustTargetOperationFact = {
    kind: "project-type-test",
    operationId: `tsonic.rust.project-type-test.${plan.lowering.kind}`,
    ...plan,
    resultCarrier,
  };
  return acceptRustOperation(fact, {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration,
  }, resultCarrier);
}

function mapSelectedUnaryOperator(
  request: RustCheckedOperatorSelectionInput,
  operand: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const operandNode = asNode(request.left, context);
  if ((request.operator === "-" || request.operator === "+") &&
    operandNode !== undefined && (context.ast.kindName(operandNode) === "KindNumericLiteral" ||
      context.ast.kindName(operandNode) === KindBigIntLiteral)) return acceptPostCheckOperator(request);
  const fact = selectRustCheckedUnaryOperation(request.operator, operand);
  return fact === undefined
    ? rejectSelectedOperation(request.expression, context, "RUST_UNARY_OPERATOR_UNSUPPORTED", `Checked unary operator '${request.operator}' has no closed Rust operation for the selected operand carrier.`)
    : acceptRustOperation(fact, { sourceExpression: request.expression, sourceReceiver: request.left });
}

export function selectedCallArgumentNodes(
  request: RustCheckedCallSelectionInput,
): readonly Node[] {
  return request.source.sourceArguments.map((argument) => argument.expression);
}

export function selectedCallArgumentCarriers(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): readonly (TargetTypeRef | undefined)[] {
  return request.source.sourceArguments.map((argument) =>
    selectedSourceValueCarrier(argument, context, options));
}

export function selectedSourceValueCarrier(
  value: RustCheckedCallSelectionInput["source"]["sourceArguments"][number],
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  if (context.ast.is.IsSpreadElement(value.expression)) {
    const operand = context.ast.as.AsSpreadElement(value.expression)?.Expression;
    if (operand !== undefined && sourceSequenceInputIsEmpty(context.ast, operand)) return { kind: "tuple", elements: [] };
    return operand === undefined
      ? undefined
      : rustEffectiveValueCarrier(context.records, operand) ??
        resolveRustTargetTypeRef(operand, context, options);
  }
  return selectedValueCarrier(value.expression, value.type, context, options);
}

export function selectedCallCalleeSymbol(
  request: RustCheckedCallSelectionInput,
): import("@tsonic/tsts").Symbol | undefined {
  return request.source.sourceCallee.selectedSymbol ??
    request.source.sourceCallee.symbol;
}

export function selectedCallCalleeDeclaration(
  request: RustCheckedCallSelectionInput,
): Node | undefined {
  return request.source.sourceCallee.selectedDeclaration ??
    request.source.sourceCallee.declaration;
}
