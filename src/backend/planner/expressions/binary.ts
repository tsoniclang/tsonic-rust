import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { RustExpressionAccess, RustExpressionResultUse } from "./entry.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustStringConcat, type RustStringConcatPart } from "../../target-ast/syntax/expressions.js";
import { planRustStringConcatOperand } from "./string-concat-parts.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { registerAliasFromPath, rustActiveErrorType } from "../program/plan-context.js";
import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import { applyFinalizedValueConversion, applyRustValueConversion } from "./value-conversions.js";
import { applyRustArgumentMode } from "./input-shaping.js";
import { planExpression, planExpressionBeforeValueProjections } from "./entry.js";
import { planRustDiscardedValue } from "./discarded-values.js";
import { planRustUnionEquality } from "./union-equality.js";
import { planRustClosedTypeTest } from "./type-tests.js";
import { planRustOptionEquality } from "./option-equality.js";
import { planNullishAssignment } from "./nullish-assignment.js";
import { planNullishCoalescing } from "./nullish-coalescing.js";
import { planCompoundAssignmentExpression } from "./compound-assignment.js";
import { planRustProgramErrorEquality, planRustProgramErrorTypeTest } from "./error-operations.js";
import { planRustGenericCallableIdentity } from "./generic-callable-identities.js";
import { planRustScopedStringComparison } from "./scoped-comparisons.js";
import { planEmptyStringComparison, planRustRangeContainment, planBooleanLiteralComparison } from "./native-comparisons.js";
import { planRustNativeZeroComparison } from "./native-zero-comparisons.js";
import { planRustNativeIntegerIdentity } from "./native-integer-identities.js";
import { rustErrorFieldComparisonView, rustErrorFieldOptionalView } from "./error-field-borrows.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import { planRustProjectTypeTest, planRustProjectTypeTestSelection } from "../objects/project-downcasts.js";
import { requireRustReadOwnership } from "./typed-locations.js";

export interface RustPlannedProjectTypeTest {
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "project-type-test" }>;
  readonly leftNode: Node;
  readonly left: RustExpr;
  readonly test: RustExpr;
  readonly selection?: import("../objects/project-downcasts.js").RustProjectTypeTestSelectionPlan;
}

export function planSelectedRustProjectTypeTest(node: Node, context: RustPlanContext): RustPlannedProjectTypeTest | undefined {
  const selected = context.input.program.records.binaryEmission.get(node);
  if (selected?.fact.kind !== "project-type-test") return undefined;
  const fact = selected.fact;
  const left = planExpression(selected.left, context, "value", selected.leftShared ? "shared-receiver" : "value");
  if (left === undefined) return undefined;
  const selection = selected.selectionTest ? planRustProjectTypeTestSelection(node, left, fact, context) : undefined;
  if (selected.selectionTest && selection === undefined) failRustPlannerInvariant("An admitted native type test requires its sealed dispatch selection.", node);
  const test = selection === undefined ? planRustProjectTypeTest(node, left, fact, context)
    : { kind: "option-presence" as const, receiver: selection.expression, present: true };
  return test === undefined ? undefined : { fact, leftNode: selected.left, left, test, ...(selection === undefined ? {} : { selection }) };
}

export function planBinaryExpression(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse = "value",
  access: RustExpressionAccess = "value"): RustExpr | undefined {
  const selected = context.input.program.records.binaryEmission.get(node)
    ?? failRustPlannerInvariant("An admitted binary expression requires its selected native emission plan.", node);
  const { fact, left: leftNode, right: rightNode } = selected;
  if (fact.kind === "logical-value") {
    if (fact.branch === "left") {
      const value = planExpression(leftNode, context);
      return value === undefined ? undefined : applyFinalizedValueConversion(context,
        { stage: "source", expression: value, node: leftNode }, fact.leftConversion!, leftNode);
    }
    if (fact.branch === "right") {
      const preceding = planRustDiscardedValue(leftNode, context);
      const value = planExpression(rightNode, context);
      const converted = value === undefined ? undefined : applyFinalizedValueConversion(context,
        { stage: "source", expression: value, node: rightNode }, fact.rightConversion!, rightNode);
      return preceding === undefined || converted === undefined ? undefined
        : { kind: "evaluate-then", effect: preceding.expression, discard: preceding.discard, value: converted };
    }
    const condition = planExpression(leftNode, context);
    const value = planExpression(rightNode, context);
    const constant = applyFinalizedValueConversion(context,
      { stage: "finalized", expression: { kind: "bool-literal", value: fact.operator === "or" } }, fact.leftConversion!, leftNode);
    const converted = value === undefined ? undefined : applyFinalizedValueConversion(context,
      { stage: "source", expression: value, node: rightNode }, fact.rightConversion!, rightNode);
    return condition === undefined || constant === undefined || converted === undefined ? undefined
      : { kind: "conditional", condition, whenTrue: fact.operator === "and" ? converted : constant, whenFalse: fact.operator === "and" ? constant : converted };
  }
  if (fact.kind === "sequence") {
    const left = planRustDiscardedValue(leftNode, context);
    if (left === undefined || selected.leftNever) return left?.expression;
    const right = planExpression(rightNode, context, resultUse, access);
    return right === undefined ? undefined : { kind: "evaluate-then", effect: left.expression, discard: left.discard, value: right };
  }
  if (fact.kind === "union-equality") return planRustUnionEquality(node, fact, context);
  if (fact.kind === "closed-type-test") return planRustClosedTypeTest(node, fact, context);
  if (fact.kind === "project-type-test") return planSelectedRustProjectTypeTest(node, context)?.test;
  if (fact.kind === "nullish-assignment") return planNullishAssignment(node, context, resultUse);
  if (fact.kind === "option-coalesce") return planNullishCoalescing(node, context);
  if (fact.kind === "nullish-identity") return planExpression(leftNode, context);
  if (fact.kind === "option-equality") return planRustOptionEquality(node, fact, context);
  if (selected.compound && (fact.kind === "operator-token" || fact.kind === "operator-call"))
    return planCompoundAssignmentExpression(node, context);
  if (fact.kind === "program-error-type-test") {
    const left = planExpression(leftNode, context);
    return left === undefined ? undefined : planRustProgramErrorTypeTest(node, left, fact, context);
  }
  if (fact.kind === "option-check") {
    const optionNode = fact.optionOperand === "left" ? leftNode : rightNode;
    const nullishNode = fact.optionOperand === "left" ? rightNode : leftNode;
    const option = planExpressionBeforeValueProjections(optionNode, context, "value");
    const nullish = planExpressionBeforeValueProjections(nullishNode, context, "value");
    if (option === undefined || nullish === undefined) return undefined;
    const checkPlan = selected.optionCheck ?? failRustPlannerInvariant("An admitted Option test requires its native absence-depth plan.", node);
    const patterns: RustPattern[] = fact.nullishDepths.map(depth => {
      let pattern: RustPattern = { kind: "path", path: "None" };
      for (let layer = 0; layer < depth; layer++) pattern = { kind: "tuple-variant", path: "Some", elements: [pattern] };
      return pattern;
    });
    const check = (receiver: RustExpr): RustExpr => {
      if (fact.nullishDepths.length === 1 && fact.nullishDepths[0] === 0) {
        if (checkPlan.custom) {
          const value = planRustOptionalStorageOperation(fact.optionCarrier, "is_absent", [{ kind: "reference", expr: receiver }], context);
          return fact.negated ? { kind: "unary", operator: "!", operand: value } : value;
        }
        return { kind: "option-presence", receiver, present: fact.negated };
      }
      const matched: RustExpr = { kind: "matches", expression: receiver, pattern: patterns.length === 1 ? patterns[0]! : { kind: "or", alternatives: patterns } };
      return fact.negated ? { kind: "unary", operator: "!", operand: matched } : matched;
    };
    if (checkPlan.skipNullish) return check(rustErrorFieldOptionalView(optionNode, option, context));
    if (fact.optionOperand === "right") return { kind: "evaluate-then", effect: nullish, discard: checkPlan.nullishUnit ? "unit" : "value", value: check(option) };
    const name = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "option_value");
    return rustValueBlock([{ name, value: option }], { kind: "evaluate-then", effect: nullish, discard: checkPlan.nullishUnit ? "unit" : "value", value: check({ kind: "path", path: name }) });
  }
  const generic = context.input.program.records.genericIdentity.get(node);
  if (generic !== undefined) return planRustGenericCallableIdentity(node, generic.comparison, context);
  const comparison = context.input.program.records.nativeComparison.get(node);
  if (comparison?.kind === "range") return planRustRangeContainment(node, context);
  if (comparison?.kind === "integer-constant") return { kind: "bool-literal", value: comparison.value };
  if (comparison?.kind === "scoped-string") return planRustScopedStringComparison(node, context);
  if (fact.kind === "string-concat") {
    const nodes = selected.concatParts ?? failRustPlannerInvariant("An admitted concatenation requires its ordered source operands.", node);
    const parts: RustStringConcatPart[] = [];
    for (const operand of nodes) {
      const read = requireRustReadOwnership(operand, context).source;
      const value = planExpression(operand, context, "value", read.kind === "borrow" || read.kind === "copy" ? "shared-place" : "value");
      if (value === undefined) return undefined;
      parts.push(planRustStringConcatOperand(operand, value, context));
    }
    return rustStringConcat(parts);
  }
  const leftView = context.input.program.records.stringComparisonView.get(leftNode);
  const rightView = context.input.program.records.stringComparisonView.get(rightNode);
  const leftReference = fact.kind === "operator-call" && selected.leftShared ||
    leftView?.kind === "native-str-reference" && leftView.inputForm === "shared-reference";
  const rightReference = fact.kind === "operator-call" && selected.rightShared ||
    rightView?.kind === "native-str-reference" && rightView.inputForm === "shared-reference";
  const left = planExpression(leftNode, context, "value", leftReference ? "shared-reference" : selected.leftShared ? "shared-place" : "value");
  const right = planExpression(rightNode, context, "value", rightReference ? "shared-reference" : selected.rightShared ? "shared-place" : "value");
  if (left === undefined || right === undefined) return undefined;
  if (fact.kind === "program-error-equality") return planRustProgramErrorEquality(node, left, right, fact, context);
  if (fact.kind === "constant-equality") {
    let value: RustExpr = { kind: "bool-literal", value: fact.value };
    if (selected.constantRightEffect) value = { kind: "evaluate-then", effect: right, discard: selected.rightUnit ? "unit" : "value", value };
    if (selected.constantLeftEffect) value = { kind: "evaluate-then", effect: left, discard: selected.leftUnit ? "unit" : "value", value };
    return value;
  }
  if (fact.kind === "operator-call") return planRustOperatorCallExpression(fact,
    { expression: left, form: leftReference ? "shared-reference" : "value", node: leftNode },
    { expression: right, form: rightReference ? "shared-reference" : "value", node: rightNode }, node, context);
  if (fact.kind !== "operator-token") failRustPlannerInvariant("An admitted binary form requires its selected native operator.", node);
  const operator = selected.operator ?? failRustPlannerInvariant("An admitted binary form requires its native binary token.", node);
  const first = applyRustValueConversion(context, { stage: "source", expression: left, node: leftNode }, fact.leftConversion, leftNode);
  const second = applyRustValueConversion(context, { stage: "source", expression: right, node: rightNode }, fact.rightConversion, rightNode);
  if (first === undefined || second === undefined) return undefined;
  if (selected.int32Remainder) return { kind: "numeric-cast", target: "f64", expression: { kind: "binary", operator: "%",
    left: { kind: "numeric-cast", target: "i32", expression: first }, right: { kind: "numeric-cast", target: "i32", expression: second } } };
  const simplified = planRustNativeIntegerIdentity(node, first, second, context) ?? planRustNativeZeroComparison(node, first, second, context) ??
    planBooleanLiteralComparison(node, first, second, context) ?? planEmptyStringComparison(node, first, second, context);
  if (simplified !== undefined) return simplified;
  const compare = operator === "==" || operator === "!=";
  const borrowedLeft = compare ? rustErrorFieldComparisonView(leftNode, first, rightNode, context) : first;
  const borrowedRight = compare ? rustErrorFieldComparisonView(rightNode, second, undefined, context) : second;
  return { kind: "binary", operator,
    left: selected.leftLiteral === undefined ? borrowedLeft : { kind: "str-literal", value: selected.leftLiteral },
    right: selected.rightLiteral === undefined ? borrowedRight : { kind: "str-literal", value: selected.rightLiteral } };
}

export function planRustOperatorCallExpression(fact: Extract<RustTargetOperationFact, { readonly kind: "operator-call" }>,
  left: { readonly expression: RustExpr; readonly form: "value" | "shared-reference"; readonly node?: Node },
  right: { readonly expression: RustExpr; readonly form: "value" | "shared-reference"; readonly node?: Node },
  node: Node, context: RustPlanContext): RustExpr | undefined {
  registerAliasFromPath(context, fact.path);
  if (fact.fallible && rustActiveErrorType(context) === undefined) failRustPlannerInvariant("An admitted fallible operator requires its selected native error ABI.", node);
  const operands = [{ ...left, mode: fact.operandModes[0], conversion: fact.leftConversion }, { ...right, mode: fact.operandModes[1], conversion: fact.rightConversion }]
    .map(({ expression, form, node: operandNode, mode, conversion }) => {
      if (form === "shared-reference" && mode === "mut-ref") failRustPlannerInvariant("An admitted operator cannot mutably consume a shared native operand.", operandNode ?? node);
      if (form === "shared-reference" && mode === "ref" && conversion === undefined) return expression;
      const value: RustExpr = form === "shared-reference" ? { kind: "dereference", pointer: expression } : expression;
      const converted = applyRustValueConversion(context, operandNode !== undefined && form === "value"
        ? { stage: "source", expression: value, node: operandNode }
        : { stage: "finalized", expression: value }, conversion, operandNode);
      return converted === undefined ? undefined : applyRustArgumentMode(context,
        conversion === undefined && operandNode !== undefined && form === "value"
          ? { stage: "source", expression: converted, node: operandNode }
          : { stage: "finalized", expression: converted }, mode);
    });
  if (operands.some(operand => operand === undefined)) return undefined;
  const call: RustExpr = { kind: "call", path: fact.path, args: operands as readonly RustExpr[] };
  return fact.fallible ? rustPropagateLocalError(context.fallibleBoundary!, rustTargetRuntimeErrorType, call) : call;
}
