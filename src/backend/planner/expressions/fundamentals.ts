import {
  KindBinaryExpression,
  KindElementAccessExpression,
  KindNonNullExpression,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  BinaryExpression_Left,
  BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
  TemplateExpression_Head,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
  TemplateSpan_Literal,
} from "@tsonic/target-api/source";
import {
  rustPostCheckOperationKind,
  rustProjectDowncastFactKey,
  rustProjectUpcastFactKey,
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { applyRustValueConversion, finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import { diagnosticInput, rustActiveErrorType } from "../program/plan-context.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { isFloatCarrier, rustTypeFromCarrierInContext } from "../types/render.js";
import { isRustBigIntCarrier, isRustIntegerCarrier, isRustStringCarrier } from "../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { negateRustBooleanExpression, rustStringConcat } from "../../target-ast/expressions.js";
import { parseSourceBigIntLiteral, parseSourceIntegerLiteral } from "../../../target-model/syntax/literals.js";
import { planExpression } from "./entry.js";
import { planRustFallibleReturnExpression } from "../statements/completion-exits.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { requireProviderArgumentPassingFacts } from "./calls/arguments.js";
import { rustArgumentPassingMode } from "../../../analysis/facts/parameter-passing.js";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeOptionProjection } from "../../../analysis/facts/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { validateRustFinalizedOperationAbi } from "../../../analysis/facts/finalized-operation-abi.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustSelectedTargetOperation as TargetOperationFact, TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";

export function rustCallableConstructionType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustTypeFromCarrierInContext(carrier, context);
}

export function planGeneratorResumeExpression(
  resume: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.generator-resume-names",
      "Generator resume lowering requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const nextName = allocateRustSyntheticName(context.syntheticNames, "generator_next");
  const returnName = allocateRustSyntheticName(context.syntheticNames, "generator_return");
  const errorName = allocateRustSyntheticName(context.syntheticNames, "generator_error");
  const activeErrorType = rustActiveErrorType(context);
  if (activeErrorType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.generator-error-boundary",
      "Generator resume lowering requires one exact error boundary.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  return {
    kind: "match",
    expression: resume,
    arms: [{
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Next",
        elements: [{ kind: "binding", name: nextName }],
      },
      expression: { kind: "path", path: nextName },
    }, {
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Return",
        elements: [{ kind: "binding", name: returnName }],
      },
      expression: planRustFallibleReturnExpression(
        { kind: "path", path: returnName },
        context,
      ),
    }, {
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Throw",
        elements: [{ kind: "binding", name: errorName }],
      },
      expression: {
        kind: "try",
        resultErrorType: activeErrorType,
        operandErrorType: activeErrorType,
        expr: {
          kind: "call",
          path: "Err",
          args: [{ kind: "path", path: errorName }],
        },
      },
    }],
  };
}

export function finishRuntimeCallableExpression(
  callable: RustExpr,
  captureBindings: readonly { readonly name: string; readonly value: RustExpr }[],
): RustExpr {
  return captureBindings.length === 0
    ? callable
    : { kind: "block", bindings: captureBindings, value: callable };
}

export function planTemplateExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  const head = TemplateExpression_Head(context.input.program.source.ast, node);
  const spans = TemplateExpression_TemplateSpans(context.input.program.source.ast, node);
  if (fact?.kind !== "template-string" || head === undefined || spans === undefined ||
    !isDenseDataArray(spans) || spans.some((span) => span === undefined) ||
    spans.length !== fact.substitutions.length ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.template-carrier")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.template",
      "Template expression requires one exact finalized substitution contract.",
    ));
    return undefined;
  }
  const parts: RustExpr[] = [{ kind: "string-literal", value: context.input.program.source.ast.text(head) }];
  for (const [index, span] of (spans as readonly Node[]).entries()) {
    const expression = TemplateSpan_Expression(context.input.program.source.ast, span);
    const literal = TemplateSpan_Literal(context.input.program.source.ast, span);
    const substitution = fact.substitutions[index];
    const actualCarrier = expression === undefined
      ? undefined
      : rustEffectiveValueCarrier(context.input.program.facts, expression);
    if (expression === undefined || literal === undefined || substitution === undefined ||
      substitution.expression !== expression || actualCarrier === undefined ||
      !rustTargetTypeRefEquals(actualCarrier, substitution.carrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, span),
        "rust.backend.template-substitution",
        "Template substitution conflicts with its finalized expression identity or carrier.",
      ));
      return undefined;
    }
    const value = planExpression(expression, context);
    if (value === undefined) {
      return undefined;
    }
    const selectedValue = planRustNonConsumingValue(expression, value, context);
    if (isRustStringCarrier(substitution.carrier)) {
      parts.push(selectedValue);
    } else {
      context.usedAliases?.add("rt");
      parts.push({
        kind: "call",
        path: "rt::source_string",
        args: [{ kind: "reference", expr: selectedValue }],
      });
    }
    parts.push({ kind: "string-literal", value: context.input.program.source.ast.text(literal) });
  }
  return rustStringConcat(parts);
}

export function planDeleteExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  const operand = Node_Expression(context.input.program.source.ast, node);
  const receiver = operand === undefined ? undefined : Node_Expression(context.input.program.source.ast, operand);
  const index = operand === undefined
    ? undefined
    : ElementAccessExpression_ArgumentExpression(context.input.program.source.ast, operand);
  if (fact?.kind !== "provider-operation" || fact.abi.operationKind !== "indexer" ||
    operand === undefined || context.input.program.source.ast.kindName(operand) !== KindElementAccessExpression ||
    receiver === undefined || index === undefined ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.delete-carrier") ||
    !selectedOperationMatches(
      context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "indexer",
      fact.resultCarrier,
    ) || !requireProviderArgumentPassingFacts(context, fact, [index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.delete",
      "delete requires one exact finalized mutable JavaScript Array index operation.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(
    context,
    fact,
    receiver,
    [index],
    node,
    { resultUse: "value" },
  );
  return planned === undefined
    ? undefined
    : finishProviderOperationExpression(context, fact, planned, node);
}

export function expressionCarrier(node: Node, context: RustPlanContext): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ??
    context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
}

function rustPartialComparison(left: RustExpr, right: RustExpr): RustExpr {
  return {
    kind: "method-call",
    receiver: left,
    method: "partial_cmp",
    args: [{ kind: "reference", expr: right }],
  };
}

function rustOrderingVariant(name: "Less" | "Equal" | "Greater"): RustExpr {
  return {
    kind: "associated-value",
    owner: { kind: "named", path: "std::cmp::Ordering" },
    name,
  };
}

function rustOrderingValue(name: "Less" | "Equal" | "Greater"): RustExpr {
  return {
    kind: "call",
    path: "Some",
    args: [rustOrderingVariant(name)],
  };
}

export function rustPartialOrderingTest(
  left: RustExpr,
  right: RustExpr,
  operator: "==" | "!=",
  ordering: "Less" | "Equal" | "Greater",
): RustExpr {
  return {
    kind: "binary",
    operator,
    left: rustPartialComparison(left, right),
    right: rustOrderingValue(ordering),
  };
}

export function negateRustPlannedBooleanExpression(
  sourceExpression: Node | undefined,
  planned: RustExpr,
  context: RustPlanContext,
): RustExpr {
  let selectedExpression = sourceExpression;
  while (selectedExpression !== undefined) {
    const kind = context.input.program.source.ast.kindName(selectedExpression);
    if (kind !== KindParenthesizedExpression && kind !== KindSatisfiesExpression &&
      kind !== KindNonNullExpression && kind !== "KindAsExpression" &&
      kind !== "KindTypeAssertionExpression") {
      break;
    }
    selectedExpression = Node_Expression(context.input.program.source.ast, selectedExpression);
  }
  if (selectedExpression === undefined ||
    context.input.program.source.ast.kindName(selectedExpression) !== KindBinaryExpression ||
    planned.kind !== "binary") {
    return negateRustBooleanExpression(planned);
  }
  const left = BinaryExpression_Left(context.input.program.source.ast, selectedExpression);
  const right = BinaryExpression_Right(context.input.program.source.ast, selectedExpression);
  const inverse = planned.operator === "<" ? ">="
    : planned.operator === "<=" ? ">"
      : planned.operator === ">" ? "<="
        : planned.operator === ">=" ? "<"
          : undefined;
  if (left === undefined || right === undefined || inverse === undefined) {
    return negateRustBooleanExpression(planned);
  }
  const leftCarrier = expressionCarrier(left, context);
  const rightCarrier = expressionCarrier(right, context);
  if (isRustIntegerCarrier(leftCarrier) && isRustIntegerCarrier(rightCarrier)) {
    return { ...planned, operator: inverse };
  }
  if (!isFloatCarrier(leftCarrier) || !isFloatCarrier(rightCarrier)) {
    return negateRustBooleanExpression(planned);
  }
  const orderingName = "ordering";
  const ordering = { kind: "path" as const, path: orderingName };
  const boundary = planned.operator === "<" || planned.operator === "<=" ? "Less" : "Greater";
  const accepted = planned.operator === "<" || planned.operator === ">" ? "!=" : "==";
  return {
    kind: "method-call",
    receiver: rustPartialComparison(planned.left, planned.right),
    method: "is_none_or",
    args: [{
      kind: "closure",
      params: [{ name: orderingName, byRefCopy: false }],
      body: {
        kind: "binary",
        operator: accepted,
        left: ordering,
        right: rustOrderingVariant(boundary),
      },
    }],
  };
}

export function effectivePlannedExpressionCarrier(
  node: Node,
  context: RustPlanContext,
): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ??
    rustEffectiveValueCarrier(context.input.program.facts, node);
}

export function requireExpressionCarrier(
  node: Node,
  expected: TargetTypeRef,
  context: RustPlanContext,
  capability: string,
): boolean {
  const actual = expressionCarrier(node, context);
  if (actual !== undefined && rustTargetTypeRefEquals(actual, expected)) {
    return true;
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    capability,
    "Finalized Rust operation result conflicts with the expression runtime carrier fact.",
  ));
  return false;
}

export function rustOperationFact(node: Node, context: RustPlanContext): RustTargetOperationFact | undefined {
  return context.input.program.facts.getFact(node, rustTargetOperationFactKey);
}

export function selectedOperationMatches(
  selected: TargetOperationFact | undefined,
  operationId: string,
  operationKind: TargetOperationFact["operationKind"],
  resultCarrier: TargetTypeRef,
  targetOperation?: string,
): boolean {
  const pendingKind = selected === undefined ? undefined : rustPostCheckOperationKind(selected.operationId);
  if (pendingKind === "binary") {
    return selected?.operationKind === operationKind && operationKind === "operator" &&
      selected.resultType === undefined && selected.targetOperation === "post-check-finalization";
  }
  const resultMatches = selected?.resultType !== undefined
    ? rustTargetTypeRefEquals(selected.resultType, resultCarrier)
    : pendingKind === "unary-minus" || pendingKind === "unary-plus";
  return selected !== undefined && selected.operationId === operationId &&
    selected.operationKind === operationKind && resultMatches &&
    (targetOperation === undefined || selected.targetOperation === targetOperation);
}

export function providerSelectedCallMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  context: RustPlanContext,
): boolean {
  if (!validateRustFinalizedOperationAbi(fact.abi)) {
    return false;
  }
  const selected = context.input.program.facts.getSelectedTargetCall(node);
  const expectedMemberKind = fact.abi.operationKind === "constructor" ? "constructor" : "method";
  return selected !== undefined && selected.member.id === fact.operationId &&
    selected.member.kind === expectedMemberKind && selected.member.returnType !== undefined &&
    rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) &&
    selected.member.parameters.length === fact.abi.sourceArguments.length &&
    selected.member.parameters.every((parameter, index) => {
      const sourceArgument = fact.abi.sourceArguments[index];
      return sourceArgument !== undefined && rustTargetTypeRefEquals(parameter.type, sourceArgument.carrier) &&
        parameter.passingMode === rustArgumentPassingMode(sourceArgument.mode);
    });
}

export function planSourceConversion(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact === undefined || fact.kind !== "source-conversion") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.conversion",
      "Source assertion requires a finalized Rust conversion fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.conversion-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
      context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      context.input.program.facts.getFact(node, rustProjectUpcastFactKey) !== undefined
        ? "project-upcast"
        : context.input.program.facts.getFact(node, rustProjectDowncastFactKey) !== undefined
          ? "project-downcast"
        : fact.conversion === undefined ? "identity" : "runtime-conversion",
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.conversion-selected-evidence",
      "Source assertion conversion conflicts with its finalized runtime carrier or TSTS-selected operation fact.",
    ));
    return undefined;
  }
  const operand = Node_Expression(context.input.program.source.ast, node);
  const planned = operand === undefined ? undefined : planExpression(operand, context);
  if (planned === undefined || fact.conversion === undefined) {
    return planned;
  }
  return applyRustValueConversion(context, planned, fact.conversion, operand);
}

export function planNumericLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const carrier = rustValueCarrierBeforeOptionProjection(context.input.program.facts, node);
  if (carrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.literal-carrier",
      "Numeric literal has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  return planNumericLiteralWithCarrier(node, carrier, context);
}

export function planBigIntLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const carrier = expressionCarrier(node, context);
  const value = parseSourceBigIntLiteral(context.input.program.source.ast.text(node));
  if (value !== undefined && isRustIntegerCarrier(carrier)) {
    return { kind: "int-literal", text: value.toString(10) };
  }
  if (!isRustBigIntCarrier(carrier) || value === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.bigint-literal",
      "BigInt literal requires exact canonical text and a finalized arbitrary-precision Rust carrier.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  return {
    kind: "call",
    path: "rt::BigInt::from_decimal_literal",
    args: [{ kind: "str-literal", value: value.toString(10) }],
  };
}

export function planNumericLiteralWithCarrier(
  node: Node,
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const text = context.input.program.source.ast.text(node);
  if (isFloatCarrier(carrier)) {
    const floatText = text.includes(".") || text.includes("e") || text.includes("E") ? text : `${text}.0`;
    return { kind: "float-literal", text: floatText };
  }
  if (isRustIntegerCarrier(carrier)) {
    const value = parseSourceIntegerLiteral(text);
    if (value === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.literal-carrier",
        `Numeric literal '${text}' cannot lower to integer carrier.`,
      ));
      return undefined;
    }
    return { kind: "int-literal", text: value.toString(10) };
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.literal-carrier",
    "Numeric literal carrier is not a supported Rust numeric carrier.",
  ));
  return undefined;
}
