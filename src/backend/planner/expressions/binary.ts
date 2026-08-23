import {
  isRustBoolCarrier,
  isRustJsStringCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  rustOptionElementCarrier,
  rustSourcePrimitiveTargetType,
} from "../../../target-model/types/index.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyRustValueConversion } from "./conversions.js";
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
import { negateRustBooleanExpression, rustBorrowedStringView, rustJsStringConcat, rustStringConcat } from "../../target-ast/expressions.js";
import { planExpression, planExpressionBeforeValueProjections } from "./entry.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { planRustProgramErrorTypeTest } from "./error-operations.js";
import { planRustProjectTypeTest } from "../objects/project-downcasts.js";
import { rustOptionProjectionFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetOperationText } from "../../../analysis/facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustValueCarrierBeforeOptionProjection } from "../../../analysis/facts/value-carrier-queries.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";

export function planBinaryExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind === "program-error-type-test") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const left = leftNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(leftNode, context, "value");
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
    return planRustProjectTypeTest(node, left, fact, context);
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
            path: fact.rightOperand === "option" ? "Some" : "std::convert::identity",
          };
    const coalesced: RustExpr = {
      kind: "call",
      path: "rt::option_coalesce",
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
    const check = (receiver: RustExpr): RustExpr => ({
      kind: "method-call",
      receiver,
      method: fact.negated ? "is_some" : "is_none",
      args: [],
    });
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
    if (optionNode === undefined || valueNode === undefined || option === undefined || value === undefined ||
      !rustTargetTypeRefEquals(optionCarrier, fact.optionCarrier) ||
      !rustTargetTypeRefEquals(valueCarrier, fact.valueCarrier) ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(fact.optionCarrier), fact.valueCarrier) ||
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
          !rustTargetTypeRefEquals(valueProjection.resultCarrier, fact.optionCarrier)))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-value-equality",
        "Option/value equality conflicts with its exact finalized operand carriers and projection.",
      ));
      return undefined;
    }
    const comparableValue: RustExpr = valueProjection === undefined
      ? { kind: "call", path: "Some", args: [value] }
      : value;
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
  if (fact !== undefined && fact.kind === "disjoint-equality") {
    const leftNode = BinaryExpression_Left(context.input.program.source.ast, node);
    const rightNode = BinaryExpression_Right(context.input.program.source.ast, node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
    if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.disjoint-equality-carrier") ||
      !selectedOperationMatches(
        context.input.program.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        rustTargetOperationText(fact),
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.disjoint-equality-selected-evidence",
        "Disjoint equality conflicts with its exact finalized source operation evidence.",
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
    const jsStringResult = isRustJsStringCarrier(fact.resultCarrier);
    for (const [sideNode, side] of [[leftNode, left], [rightNode, right]] as const) {
      if (!jsStringResult && side.kind === "string-concat") {
        parts.push(...side.parts);
      } else {
        const value = planRustNonConsumingValue(sideNode, side, context);
        const carrier = effectivePlannedExpressionCarrier(sideNode, context);
        if (!jsStringResult || isRustJsStringCarrier(carrier)) {
          parts.push(value);
        } else if (isRustStringCarrier(carrier)) {
          parts.push({ kind: "call", path: "js_abi::JsString::from", args: [value] });
        } else {
          context.usedAliases?.add("rt");
          parts.push({
            kind: "call",
            path: "js_abi::JsString::from",
            args: [{
              kind: "call",
              path: "rt::source_string",
              args: [{ kind: "reference", expr: value }],
            }],
          });
        }
      }
    }
    return jsStringResult ? rustJsStringConcat(parts) : rustStringConcat(parts);
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
      const jsStringLiteral = comparison && borrowed.kind === "call" &&
          borrowed.path === "js_abi::JsString::from" &&
          borrowed.args.length === 1 && borrowed.args[0]?.kind === "str-literal"
        ? borrowed.args[0]
        : undefined;
      if (jsStringLiteral !== undefined) {
        return jsStringLiteral;
      }
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
    !isRustBoolCarrier(expressionCarrier(literal.otherNode, context))) {
    return undefined;
  }
  const negated = operator === "==" ? !literal.value : literal.value;
  return negated
    ? negateRustBooleanExpression(literal.other)
    : literal.other;
}
