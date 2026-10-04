import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_OperatorToken } from "@tsonic/target-api/source";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustClosedTypeTestPlan, RustClosedTypePredicate } from "../../../target-model/operations/type-tests.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustClosedTypeTestMatches } from "../../../analysis/facts/operations/type-tests.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "./entry.js";
import { planRustUnionPattern } from "./union-patterns.js";
import { planRustProjectTypeTest } from "../objects/project-downcasts.js";
import { effectivePlannedExpressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";

export function planRustClosedTypeTest(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "closed-type-test" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const ast = context.input.program.source.ast;
  const nominal = fact.predicate?.kind !== "array";
  const arguments_ = ast.is.IsCallExpression(node) ? ast.arguments(node) : [];
  const left = nominal ? BinaryExpression_Left(ast, node) : arguments_[0];
  const token = BinaryExpression_OperatorToken(ast, node);
  const syntaxMatches = nominal ? token !== undefined && ast.kindName(token) === "KindInstanceOfKeyword"
    : ast.is.IsCallExpression(node) && arguments_.length === 1 && left !== undefined && !ast.is.IsSpreadElement(left);
  if (left === undefined || !syntaxMatches ||
    !rustClosedTypeTestMatches(fact, context.input.program.projectTypes, context.input.program.typeDefinitions) ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(left, context), fact.sourceCarrier) ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.closed-type-test-result") ||
    !selectedOperationMatches(nominal ? context.input.program.facts.getSelectedTargetOperator(node)
      : context.input.program.facts.getSelectedTargetOperation(node),
      fact.operationId, nominal ? "operator" : "method", fact.resultCarrier, "closed-type-test")) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.closed-type-test", "Type predicate requires its exact selected operation, carrier and retained test plan."));
    return undefined;
  }
  const expression = planExpression(left, context, "value", "shared-reference");
  return expression === undefined ? undefined : planTest(node, expression, fact.sourceCarrier, fact.test, fact.predicate, context);
}

function planTest(
  node: Node,
  expression: RustExpr,
  carrier: TargetTypeRef,
  test: RustClosedTypeTestPlan,
  predicate: RustClosedTypePredicate,
  context: RustPlanContext,
): RustExpr | undefined {
  if (test.kind === "constant") return { kind: "evaluate-then", effect: expression, discard: "value",
    value: { kind: "bool-literal", value: test.value } };
  if (test.kind === "runtime-array") {
    context.usedAliases?.add("js_abi");
    return { kind: "call", path: "js_abi::array_is_array_value", args: [expression] };
  }
  if (test.kind === "project") return planRustProjectTypeTest(node, expression, test.plan, context);
  if (test.kind === "error") {
    if (predicate.kind !== "error") return undefined;
    const receiver = expression.kind === "reference" ? expression.expr : expression;
    if (predicate.errorKind === "any") {
      return test.lowering === "native-error"
        ? { kind: "evaluate-then", effect: expression, discard: "value", value: { kind: "bool-literal", value: true } }
        : { kind: "method-call", receiver, method: "is_error", args: [] };
    }
    context.usedAliases?.add("rt");
    const kind: RustExpr = { kind: "path", path: `rt::JsErrorKind::${predicate.errorKind}` };
    return test.lowering === "native-error"
      ? { kind: "binary", left: { kind: "call", path: "rt::ErrorObject::error_kind", args: [expression] }, operator: "==", right: kind }
      : { kind: "method-call", receiver, method: "is_error_kind", args: [kind] };
  }
  if (context.syntheticNames === undefined) return undefined;
  if (test.kind === "option") {
    const name = allocateRustSyntheticName(context.syntheticNames, "instance");
    const body = planTest(node, { kind: "path", path: name }, test.element, test.test, predicate, context);
    return body === undefined ? undefined : { kind: "method-call",
      receiver: { kind: "method-call", receiver: expression.kind === "reference" ? expression.expr : expression,
        method: "as_ref", args: [] }, method: "is_some_and",
      args: [{ kind: "closure", params: [{ name, byRefCopy: false }], body }] };
  }
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const arm of test.arms) {
    const constant = arm.test.kind === "constant" ? arm.test :
      arm.test.kind === "project" && arm.test.plan.lowering.kind === "constant" ? arm.test.plan.lowering : undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, "instance");
    const pattern = planRustUnionPattern([{ union: carrier, variant: arm.variant }],
      constant === undefined ? { kind: "binding", name } : { kind: "wildcard" }, context);
    const value = constant === undefined ? planTest(node, { kind: "path", path: name }, arm.carrier, arm.test, predicate, context)
      : { kind: "bool-literal" as const, value: constant.value };
    if (pattern === undefined || value === undefined) return undefined;
    arms.push({ pattern, expression: value });
  }
  if (arms.every(arm => arm.expression.kind === "bool-literal")) {
    const matching = arms.filter(arm => arm.expression.kind === "bool-literal" && arm.expression.value).map(arm => arm.pattern);
    return matching.length === 0 || matching.length === arms.length
      ? { kind: "evaluate-then", effect: expression, discard: "value", value: { kind: "bool-literal", value: matching.length !== 0 } }
      : { kind: "matches", expression, pattern: matching.length === 1 ? matching[0]! : { kind: "or", alternatives: matching } };
  }
  return { kind: "match", expression, arms };
}
