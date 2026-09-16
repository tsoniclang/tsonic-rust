import {
  isRustBoolCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  rustOptionElementCarrier,
  rustSourcePrimitiveTargetType,
} from "../../../target-model/types/index.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { applyRustArgumentMode } from "./input-shaping.js";
import { applyRustFallibleResultExpression, rustExpressionUsesTryInCurrentRegion } from "../types/fallible-shape.js";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
} from "@tsonic/target-api/source";
import { diagnosticInput, registerAliasFromPath, rustActiveErrorType } from "../program/plan-context.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import { effectivePlannedExpressionCarrier, expressionCarrier, requireExpressionCarrier, rustOperationFact, rustPartialOrderingTest, selectedOperationMatches } from "./fundamentals.js";
import { isRustBinaryOperator } from "../../../target-model/syntax/tokens.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { negateRustBooleanExpression, rustBorrowedStringView, rustStringConcat } from "../../target-ast/expressions.js";
import { foldRustIntegerComparison } from "../../target-ast/integer-comparisons.js";
import { planExpression, planExpressionBeforeValueProjections } from "./entry.js";
import type { RustExpressionResultUse } from "./entry.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { planNullishAssignment } from "./nullish-assignment.js";
import { planRustProgramErrorEquality, planRustProgramErrorTypeTest } from "./error-operations.js";
import { planRustBuiltinErrorTypeTest } from "./builtin-errors.js";
import {
  planRustProjectTypeTest,
  planRustProjectTypeTestSelection,
} from "../objects/project-downcasts.js";
import { rustOptionProjectionFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetOperationText } from "../../../analysis/facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustOptionNestingDepth } from "../../../target-model/types/carriers/optional.js";
import { rustValueCarrierBeforeOptionProjection } from "../../../analysis/facts/value-carrier-queries.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export interface RustPlannedProjectTypeTest {
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "project-type-test" }>;
  readonly leftNode: Node;
  readonly left: RustExpr;
  readonly test: RustExpr;
  readonly selection?: import("../objects/project-downcasts.js").RustProjectTypeTestSelectionPlan;
}

export function planSelectedRustProjectTypeTest(
  node: Node,
  context: RustPlanContext,
): RustPlannedProjectTypeTest | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind !== "project-type-test") {
    return undefined;
  }
  const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
  const plannedLeft = leftNode === undefined ? undefined : planExpression(leftNode, context);
  const left = leftNode === undefined || plannedLeft === undefined
    ? undefined
    : planRustNonConsumingValue(leftNode, plannedLeft, context);
  if (leftNode === undefined || left === undefined ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(leftNode, context), fact.sourceCarrier) ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.project-type-test-carrier") ||
    !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      "project-type-test",
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-type-test-selected-evidence",
      "Project type test conflicts with its exact finalized source operation evidence.",
    ));
    return undefined;
  }
  const selection = fact.lowering.kind === "dispatch" &&
      rustTargetTypeRefEquals(fact.sourceCarrier, fact.dispatchCarrier)
    ? planRustProjectTypeTestSelection(node, left, fact, context)
    : undefined;
  const test = selection === undefined
    ? planRustProjectTypeTest(node, left, fact, context)
    : {
        kind: "option-presence" as const,
        receiver: selection.expression,
        present: true,
      };
  return test === undefined
    ? undefined
    : { fact, leftNode, left, test, ...(selection === undefined ? {} : { selection }) };
}

export function planBinaryExpression(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse = "value"): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind === "program-error-equality") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
    if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined ||
      !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(leftNode, context),
        fact.errorOperand === "left" ? fact.sourceCarrier : fact.targetCarrier) ||
      !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(rightNode, context),
        fact.errorOperand === "right" ? fact.sourceCarrier : fact.targetCarrier) ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.program-error-equality-carrier") ||
      !selectedOperationMatches(context.input.program.facts.getSelectedTargetOperator(node),
        fact.operationId, "operator", fact.resultCarrier, fact.operationId)) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.program-error-equality-evidence", "Program-error equality requires its exact finalized operand carriers."));
      return undefined;
    }
    return planRustProgramErrorEquality(node, left, right, fact, context);
  }
  if (fact?.kind === "builtin-error-type-test") {
    return planRustBuiltinErrorTypeTest(node, fact, context);
  }
  if (fact?.kind === "program-error-type-test") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    if (leftNode === undefined || left === undefined ||
      !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(leftNode, context), fact.sourceCarrier) ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.program-error-type-test-carrier") ||
      !selectedOperationMatches(
        context.input.program.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        "program-error-type-test",
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.program-error-type-test-selected-evidence",
        "Program-error type test conflicts with its exact finalized source operation evidence.",
      ));
      return undefined;
    }
    return planRustProgramErrorTypeTest(node, left, fact, context);
  }
  if (fact?.kind === "project-type-test") {
    return planSelectedRustProjectTypeTest(node, context)?.test;
  }
  if ((fact?.kind === "operator-token" || fact?.kind === "operator-call" || fact?.kind === "string-concat") &&
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.operator-carrier")) {
    return undefined;
  }
  if ((fact?.kind === "operator-token" || fact?.kind === "operator-call" || fact?.kind === "string-concat") &&
    !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      rustTargetOperationText(fact),
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator-selected-evidence",
      "Binary Rust operator fact conflicts with the TSTS-selected operator fact.",
    ));
    return undefined;
  }
  if (fact?.kind === "nullish-assignment") return planNullishAssignment(node, fact, context, resultUse);
  if (fact !== undefined && fact.kind === "nullish-identity") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.nullish-carrier")) {
      return undefined;
    }
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    return leftNode === undefined ? undefined : planExpression(leftNode, context);
  }
  if (fact !== undefined && fact.kind === "option-coalesce") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
    const left = leftNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(leftNode, context, "value");
    const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
    if (left === undefined || right === undefined ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.option-coalesce-carrier") ||
      !selectedOperationMatches(
        context.input.program.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        rustTargetOperationText(fact),
      )) {
      return undefined;
    }
    context.usedAliases?.add("rt");
    const fallbackIsFallible = rustExpressionUsesTryInCurrentRegion(right);
    const activeErrorType = rustActiveErrorType(context);
    if (fallbackIsFallible && activeErrorType === undefined) {
      return undefined;
    }
    const fallback: RustExpr = !fallbackIsFallible && right.kind === "call" && right.args.length === 0
      ? { kind: "path", path: right.path }
      : {
          kind: "closure",
          params: [],
          body: fallbackIsFallible
            ? applyRustFallibleResultExpression(right, {
                errorType: activeErrorType!,
              })
            : right,
        };
    const presentValueName = allocateRustSyntheticName(
      context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
      "present_value",
    );
    const present: RustExpr = fallbackIsFallible && fact.rightOperand !== "option"
      ? { kind: "path", path: "Ok" }
      : fallbackIsFallible
        ? {
            kind: "closure",
            params: [{ name: presentValueName, byRefCopy: false }],
            body: {
              kind: "call",
              path: "Ok",
              args: [fact.rightOperand === "option"
                ? { kind: "call", path: "Some", args: [{ kind: "path", path: presentValueName }] }
                : { kind: "path", path: presentValueName }],
            },
          }
        : {
            kind: "path",
            path: fact.rightOperand === "option" ? "Some" : "core::convert::identity",
          };
    const coalescedValueType = fallbackIsFallible ? rustTypeFromCarrierInContext(fact.resultCarrier, context) : undefined;
    if (fallbackIsFallible && coalescedValueType === undefined) return undefined;
    const coalesced: RustExpr = {
      kind: "call",
      path: "rt::option_coalesce",
      ...(fallbackIsFallible ? { genericArguments: [
        { kind: "type" as const, type: { kind: "infer" as const } },
        { kind: "type" as const, type: { kind: "named" as const, path: "core::result::Result", genericArguments: [
          { kind: "type" as const, type: coalescedValueType! },
          { kind: "type" as const, type: activeErrorType! },
        ] } },
      ] } : {}),
      args: [
        left,
        present,
        fallback,
      ],
    };
    if (!fallbackIsFallible) {
      return coalesced;
    }
    context.usedAliases?.add("rt");
    return {
      kind: "try",
      expr: coalesced,
      resultErrorType: activeErrorType!,
      operandErrorType: activeErrorType!,
    };
  }
  if (fact !== undefined && fact.kind === "option-check") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
    const optionNode = fact.optionOperand === "left" ? leftNode : rightNode;
    const nullishNode = fact.optionOperand === "left" ? rightNode : leftNode;
    const option = optionNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(optionNode, context, "value");
    const nullish = nullishNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(nullishNode, context, "value");
    const boolCarrier = rustSourcePrimitiveTargetType("bool");
    if (optionNode === undefined || nullishNode === undefined || option === undefined || nullish === undefined ||
      !rustTargetTypeRefEquals(expressionCarrier(optionNode, context), fact.optionCarrier) ||
      !rustTargetTypeRefEquals(expressionCarrier(nullishNode, context), fact.nullishCarrier) ||
      !requireExpressionCarrier(node, boolCarrier, context, "rust.backend.option-check-carrier") ||
      !selectedOperationMatches(
        context.input.program.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        boolCarrier,
        rustTargetOperationText(fact),
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-check",
        "Option presence check conflicts with its exact finalized operand carriers or selected operation.",
      ));
      return undefined;
    }
    const patterns: RustPattern[] = [];
    const rejectDepths = (): undefined => {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.option-check-depths", "Option nullish depths must be ordered, unique and contained in the exact operand carrier."));
      return undefined;
    };
    if (!Array.isArray(fact.nullishDepths) || fact.nullishDepths.length === 0) return rejectDepths();
    for (const [index, depth] of fact.nullishDepths.entries()) {
      let carrier = fact.optionCarrier;
      let pattern: RustPattern = { kind: "path", path: "None" };
      if (!Number.isSafeInteger(depth) || depth < 0 ||
        (index > 0 && depth <= fact.nullishDepths[index - 1]!)) return rejectDepths();
      for (let layer = 0; layer < depth; layer += 1) {
        const element = rustOptionElementCarrier(carrier);
        if (element === undefined) return rejectDepths();
        carrier = element;
        pattern = { kind: "tuple-variant", path: "Some", elements: [pattern] };
      }
      if (rustOptionElementCarrier(carrier) === undefined) return rejectDepths();
      patterns.push(pattern);
    }
    const check = (receiver: RustExpr): RustExpr => {
      if (fact.nullishDepths.length === 1 && fact.nullishDepths[0] === 0) {
        return { kind: "option-presence", receiver, present: fact.negated };
      }
      const matched: RustExpr = { kind: "matches", expression: receiver,
        pattern: patterns.length === 1 ? patterns[0]! : { kind: "or", alternatives: patterns } };
      return fact.negated ? { kind: "unary", operator: "!", operand: matched } : matched;
    };
    if (isExplicitRustNullishValue(nullish)) {
      return check(planRustNonConsumingValue(optionNode, option, context));
    }
    if (fact.optionOperand === "right") {
      return {
        kind: "evaluate-then",
        effect: nullish,
        discard: isRustUnitCarrier(expressionCarrier(nullishNode, context)) ? "unit" : "value",
        value: check(planRustNonConsumingValue(optionNode, option, context)),
      };
    }
    const optionName = allocateRustSyntheticName(
      context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
      "option_value",
    );
    return {
      kind: "block",
      bindings: [{ name: optionName, value: option }],
      value: {
        kind: "evaluate-then",
        effect: nullish,
        discard: isRustUnitCarrier(expressionCarrier(nullishNode, context)) ? "unit" : "value",
        value: check({ kind: "path", path: optionName }),
      },
    };
  }
  if (fact !== undefined && fact.kind === "option-equality") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
    const left = leftNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(leftNode, context, "value");
    const right = rightNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(rightNode, context, "value");
    const boolCarrier = rustSourcePrimitiveTargetType("bool");
    const leftCarrier = leftNode === undefined ? undefined : expressionCarrier(leftNode, context);
    const rightCarrier = rightNode === undefined ? undefined : expressionCarrier(rightNode, context);
    const selectedOperation = context.input.program.facts.getSelectedTargetOperator(node);
    if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined ||
      !rustTargetTypeRefEquals(leftCarrier, fact.optionCarrier) ||
      !rustTargetTypeRefEquals(rightCarrier, fact.optionCarrier) ||
      !requireExpressionCarrier(node, boolCarrier, context, "rust.backend.option-equality-carrier") ||
      !selectedOperationMatches(
        selectedOperation,
        fact.operationId,
        "operator",
        boolCarrier,
        rustTargetOperationText(fact),
      )) {
      const diagnostic = missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-equality",
        "Option equality conflicts with its exact finalized operand carrier or selected operation.",
      );
      context.diagnostics.push({
        ...diagnostic,
        evidence: [
          ...(diagnostic.evidence ?? []),
          `carrier.expected=${JSON.stringify(fact.optionCarrier)}`,
          `carrier.left=${JSON.stringify(leftCarrier)}`,
          `carrier.right=${JSON.stringify(rightCarrier)}`,
          `operation.selected.id=${selectedOperation?.operationId ?? "missing"}`,
          `operation.selected.kind=${selectedOperation?.operationKind ?? "missing"}`,
          `operation.selected.target=${selectedOperation?.targetOperation ?? "missing"}`,
        ],
      });
      return undefined;
    }
    return {
      kind: "binary",
      operator: fact.negated ? "!=" : "==",
      left: planRustNonConsumingValue(leftNode, left, context),
      right: planRustNonConsumingValue(rightNode, right, context),
    };
  }
  if (fact !== undefined && fact.kind === "option-value-equality") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
    const optionNode = fact.optionOperand === "left" ? leftNode : rightNode;
    const valueNode = fact.optionOperand === "left" ? rightNode : leftNode;
    const option = optionNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(optionNode, context, "value");
    const value = valueNode === undefined ? undefined : planExpression(valueNode, context);
    const valueProjection = valueNode === undefined
      ? undefined
      : context.input.program.facts.getFact(valueNode, rustOptionProjectionFactKey);
    const optionCarrier = optionNode === undefined
      ? undefined
      : expressionCarrier(optionNode, context);
    const valueCarrier = valueNode === undefined
      ? undefined
      : rustValueCarrierBeforeOptionProjection(context.input.program.facts, valueNode);
    const nestingDepth = rustOptionNestingDepth(fact.optionCarrier, fact.valueCarrier);
    const remainingDepth = rustOptionNestingDepth(fact.optionCarrier, valueProjection?.resultCarrier ?? fact.valueCarrier);
    if (optionNode === undefined || valueNode === undefined || option === undefined || value === undefined ||
      !rustTargetTypeRefEquals(optionCarrier, fact.optionCarrier) ||
      !rustTargetTypeRefEquals(valueCarrier, fact.valueCarrier) ||
      nestingDepth === undefined || nestingDepth === 0 || remainingDepth === undefined ||
      !requireExpressionCarrier(
        node,
        rustSourcePrimitiveTargetType("bool"),
        context,
        "rust.backend.option-value-equality-carrier",
      ) ||
      !selectedOperationMatches(
        context.input.program.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        rustSourcePrimitiveTargetType("bool"),
        rustTargetOperationText(fact),
      ) ||
      (valueProjection !== undefined &&
        (valueProjection.kind !== "some" ||
          !rustTargetTypeRefEquals(valueProjection.sourceCarrier, fact.valueCarrier) ||
          !rustTargetTypeRefEquals(rustOptionElementCarrier(valueProjection.resultCarrier), fact.valueCarrier)))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-value-equality",
        "Option/value equality conflicts with its exact finalized operand carriers and projection.",
      ));
      return undefined;
    }
    let comparableValue: RustExpr = value;
    for (let depth = 0; depth < remainingDepth; depth += 1) {
      comparableValue = { kind: "call", path: "Some", args: [comparableValue] };
    }
    return {
      kind: "binary",
      operator: fact.negated ? "!=" : "==",
      left: fact.optionOperand === "left"
        ? planRustNonConsumingValue(optionNode, option, context)
        : comparableValue,
      right: fact.optionOperand === "left"
        ? comparableValue
        : planRustNonConsumingValue(optionNode, option, context),
    };
  }
  if (fact !== undefined && fact.kind === "constant-equality") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
    if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.constant-equality-carrier") ||
      !selectedOperationMatches(
        context.input.program.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        rustTargetOperationText(fact),
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.constant-equality-selected-evidence",
        "Constant equality conflicts with its exact finalized source operation evidence.",
      ));
      return undefined;
    }
    return {
      kind: "evaluate-then",
      effect: left,
      discard: isRustUnitCarrier(expressionCarrier(leftNode, context)) ? "unit" : "value",
      value: {
        kind: "evaluate-then",
        effect: right,
        discard: isRustUnitCarrier(expressionCarrier(rightNode, context)) ? "unit" : "value",
        value: { kind: "bool-literal", value: fact.value },
      },
    };
  }
  if (fact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      "Binary expression requires a finalized Rust operator fact.",
    ));
    return undefined;
  }
  const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
  const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
  const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
  const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
  if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined) {
    return undefined;
  }
  if (fact.kind === "string-concat") {
    const parts: RustExpr[] = [];
    for (const [sideNode, side] of [[leftNode, left], [rightNode, right]] as const) {
      if (side.kind === "string-concat") {
        parts.push(...side.parts);
      } else {
        parts.push(planRustNonConsumingValue(sideNode, side, context));
      }
    }
    return rustStringConcat(parts);
  }
  if (fact.kind === "operator-call") {
    return planRustOperatorCallExpression(
      fact,
      left,
      right,
      node,
      context,
      leftNode,
      rightNode,
    );
  }
  if (fact.kind === "operator-token") {
    // Owned-String literals in comparison position lower as &str literals so
    // generated code stays clippy-clean (cmp_owned).
    const comparison = fact.operator === "==" || fact.operator === "!=";
    const convertedLeft = applyRustValueConversion(context, left, fact.leftConversion, leftNode);
    const convertedRight = applyRustValueConversion(context, right, fact.rightConversion, rightNode);
    if (convertedLeft === undefined || convertedRight === undefined) {
      return undefined;
    }
    const comparisonLeft = comparison && leftNode !== undefined
      ? planRustNonConsumingValue(leftNode, convertedLeft, context)
      : convertedLeft;
    const comparisonRight = comparison && rightNode !== undefined
      ? planRustNonConsumingValue(rightNode, convertedRight, context)
      : convertedRight;
    const borrowLiteral = (side: RustExpr): RustExpr => {
      const borrowed = comparison ? rustBorrowedStringView(side) : side;
      return comparison && borrowed.kind === "string-literal"
        ? { kind: "str-literal", value: borrowed.value }
        : borrowed;
    };
    if (!isRustBinaryOperator(fact.operator)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.operator",
        "Binary expression selected a non-binary Rust operator fact.",
      ));
      return undefined;
    }
    const integerComparison = foldRustIntegerComparison(fact.operator, comparisonLeft, comparisonRight);
    if (integerComparison !== undefined) return integerComparison;
    const booleanComparison = planBooleanLiteralComparison(
      fact.operator,
      comparisonLeft,
      comparisonRight,
      leftNode,
      rightNode,
      context,
    );
    if (booleanComparison !== undefined) {
      return booleanComparison;
    }
    const emptyStringComparison = planEmptyStringComparison(
      fact.operator,
      comparisonLeft,
      comparisonRight,
      leftNode,
      rightNode,
      context,
    );
    if (emptyStringComparison !== undefined) {
      return emptyStringComparison;
    }
    const rangeContainment = planRustRangeContainment(
      fact.operator,
      comparisonLeft,
      comparisonRight,
    );
    if (rangeContainment !== undefined) {
      return rangeContainment;
    }
    return {
      kind: "binary",
      operator: fact.operator,
      left: borrowLiteral(comparisonLeft),
      right: borrowLiteral(comparisonRight),
    };
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.operator",
    "Binary expression selected a non-operator Rust operation.",
  ));
  return undefined;
}

function isExplicitRustNullishValue(expression: RustExpr): boolean {
  return expression.kind === "none" ||
    expression.kind === "path" &&
      (expression.path === "rt::Undefined" || expression.path === "rt::Null");
}

export function planRustOperatorCallExpression(
  fact: Extract<RustTargetOperationFact, { readonly kind: "operator-call" }>,
  left: RustExpr,
  right: RustExpr,
  node: Node,
  context: RustPlanContext,
  leftNode?: Node,
  rightNode?: Node,
): RustExpr | undefined {
  registerAliasFromPath(context, fact.path);
  const activeErrorType = rustActiveErrorType(context);
  if (fact.fallible && activeErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.operator",
      "Fallible operator calls require a finalized fallible lowering context.",
    ));
    return undefined;
  }
  const operands = [
    {
      expression: left,
      node: leftNode,
      mode: fact.operandModes[0],
      conversion: fact.leftConversion,
    },
    {
      expression: right,
      node: rightNode,
      mode: fact.operandModes[1],
      conversion: fact.rightConversion,
    },
  ].map(({ expression, node: operandNode, mode, conversion }) => {
    const converted = applyRustValueConversion(context, expression, conversion, operandNode);
    if (converted === undefined) {
      return undefined;
    }
    const nonConsuming = mode === "value" || operandNode === undefined
      ? converted
      : planRustNonConsumingValue(operandNode, converted, context);
    return applyRustArgumentMode(context, nonConsuming, mode, operandNode);
  });
  if (operands.some((operand) => operand === undefined)) {
    return undefined;
  }
  const call: RustExpr = {
    kind: "call",
    path: fact.path,
    args: operands as readonly RustExpr[],
  };
  return fact.fallible
    ? {
        kind: "try",
        expr: call,
        resultErrorType: activeErrorType!,
        operandErrorType: rustTargetRuntimeErrorType,
      }
    : call;
}

function planEmptyStringComparison(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (operator !== "==" && operator !== "!=") {
    return undefined;
  }
  const emptyLiteral = (expression: RustExpr): boolean =>
    (expression.kind === "string-literal" || expression.kind === "str-literal") &&
    expression.value.length === 0;
  const selected = emptyLiteral(left)
    ? { expression: right, node: rightNode }
    : emptyLiteral(right)
      ? { expression: left, node: leftNode }
      : undefined;
  if (selected?.node === undefined ||
    !isRustStringCarrier(effectivePlannedExpressionCarrier(selected.node, context))) {
    return undefined;
  }
  const isEmpty: RustExpr = {
    kind: "method-call",
    receiver: selected.expression,
    method: "is_empty",
    args: [],
  };
  return operator === "=="
    ? isEmpty
    : negateRustBooleanExpression(isEmpty);
}

function planRustRangeContainment(
  operator: string,
  left: RustExpr,
  right: RustExpr,
): RustExpr | undefined {
  if (operator !== "&&" && operator !== "||") {
    return undefined;
  }
  const direct = planRustRangeComparisonPair(operator, left, right);
  if (direct !== undefined) {
    return direct;
  }
  if (left.kind === "binary" && left.operator === operator) {
    const trailing = planRustRangeComparisonPair(operator, left.right, right);
    if (trailing !== undefined) {
      return {
        kind: "binary",
        operator,
        left: left.left,
        right: trailing,
      };
    }
  }
  if (right.kind === "binary" && right.operator === operator) {
    const leading = planRustRangeComparisonPair(operator, left, right.left);
    if (leading !== undefined) {
      return {
        kind: "binary",
        operator,
        left: leading,
        right: right.right,
      };
    }
  }
  return undefined;
}

function planRustRangeComparisonPair(
  operator: "&&" | "||",
  left: RustExpr,
  right: RustExpr,
): RustExpr | undefined {
  if (left.kind !== "binary" || right.kind !== "binary") {
    return undefined;
  }
  const inclusive = operator === "&&" &&
    (left.operator === ">=" || left.operator === "<=") &&
    (right.operator === ">=" || right.operator === "<=");
  const exclusive = operator === "||" &&
    (left.operator === ">" || left.operator === "<") &&
    (right.operator === ">" || right.operator === "<");
  if (!inclusive && !exclusive) {
    return undefined;
  }
  const first = comparisonSubjectAndBound(left, exclusive);
  const second = comparisonSubjectAndBound(right, exclusive);
  if (first === undefined || second === undefined ||
    first.subject.path !== second.subject.path ||
    !isRustNumericLiteral(first.bound) || !isRustNumericLiteral(second.bound)) {
    return undefined;
  }
  const lower = first.relationship === "lower" ? first.bound
    : second.relationship === "lower" ? second.bound
      : undefined;
  const upper = first.relationship === "upper" ? first.bound
    : second.relationship === "upper" ? second.bound
      : undefined;
  if (lower === undefined || upper === undefined) {
    return undefined;
  }
  if (exclusive && (!isRustIntegerLiteral(lower) || !isRustIntegerLiteral(upper))) {
    if (!isRustFloatLiteral(lower) || !isRustFloatLiteral(upper)) {
      return undefined;
    }
    return {
      kind: "binary",
      operator: "||",
      left: rustPartialOrderingTest(first.subject, lower, "==", "Less"),
      right: rustPartialOrderingTest(second.subject, upper, "==", "Greater"),
    };
  }
  const contains: RustExpr = {
    kind: "method-call",
    receiver: { kind: "range", start: lower, end: upper, inclusive: true },
    method: "contains",
    args: [{ kind: "reference", expr: first.subject }],
  };
  return inclusive ? contains : negateRustBooleanExpression(contains);
}

function comparisonSubjectAndBound(
  expression: Extract<RustExpr, { readonly kind: "binary" }>,
  outsideRange: boolean,
): {
  readonly subject: Extract<RustExpr, { readonly kind: "path" }>;
  readonly bound: RustExpr;
  readonly relationship: "lower" | "upper";
} | undefined {
  if (expression.left.kind === "path" && isRustNumericLiteral(expression.right)) {
    const relationship = outsideRange
      ? expression.operator === "<" ? "lower"
        : expression.operator === ">" ? "upper"
          : undefined
      : expression.operator === ">=" ? "lower"
        : expression.operator === "<=" ? "upper"
          : undefined;
    return relationship === undefined
      ? undefined
      : { subject: expression.left, bound: expression.right, relationship };
  }
  if (expression.right.kind === "path" && isRustNumericLiteral(expression.left)) {
    const relationship = outsideRange
      ? expression.operator === ">" ? "lower"
        : expression.operator === "<" ? "upper"
          : undefined
      : expression.operator === "<=" ? "lower"
        : expression.operator === ">=" ? "upper"
          : undefined;
    return relationship === undefined
      ? undefined
      : { subject: expression.right, bound: expression.left, relationship };
  }
  return undefined;
}

function isRustNumericLiteral(expression: RustExpr): boolean {
  return expression.kind === "int-literal" || expression.kind === "float-literal" ||
    expression.kind === "unary" && expression.operator === "-" &&
      (expression.operand.kind === "int-literal" || expression.operand.kind === "float-literal");
}

function isRustIntegerLiteral(expression: RustExpr): boolean {
  return expression.kind === "int-literal" || expression.kind === "unary" &&
    expression.operator === "-" && expression.operand.kind === "int-literal";
}

function isRustFloatLiteral(expression: RustExpr): boolean {
  return expression.kind === "float-literal" || expression.kind === "unary" &&
    expression.operator === "-" && expression.operand.kind === "float-literal";
}

function planBooleanLiteralComparison(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (operator !== "==" && operator !== "!=") {
    return undefined;
  }
  const literal = left.kind === "bool-literal"
    ? { value: left.value, other: right, otherNode: rightNode }
    : right.kind === "bool-literal"
      ? { value: right.value, other: left, otherNode: leftNode }
      : undefined;
  if (literal === undefined || literal.otherNode === undefined ||
    !isRustBoolCarrier(effectivePlannedExpressionCarrier(literal.otherNode, context))) {
    return undefined;
  }
  const negated = operator === "==" ? !literal.value : literal.value;
  return negated
    ? negateRustBooleanExpression(literal.other)
    : literal.other;
}
