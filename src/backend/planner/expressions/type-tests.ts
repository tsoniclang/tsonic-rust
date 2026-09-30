import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_OperatorToken } from "@tsonic/target-api/source";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustClosedTypeTestPlan } from "../../../target-model/operations/type-tests.js";
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
  const left = BinaryExpression_Left(ast, node);
  const token = BinaryExpression_OperatorToken(ast, node);
  if (left === undefined || token === undefined || ast.kindName(token) !== "KindInstanceOfKeyword" ||
    !rustClosedTypeTestMatches(fact, context.input.program.projectTypes, context.input.program.typeDefinitions) ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(left, context), fact.sourceCarrier) ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.closed-type-test-result") ||
    !selectedOperationMatches(context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId, "operator", fact.resultCarrier, "closed-type-test")) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.closed-type-test", "Nominal type test requires its exact closed constructor, carrier and retained test plan."));
    return undefined;
  }
  const expression = planExpression(left, context, "value", "shared-reference");
  return expression === undefined ? undefined : planTest(node, expression, fact.sourceCarrier, fact.test, context);
}

function planTest(
  node: Node,
  expression: RustExpr,
  carrier: TargetTypeRef,
  test: RustClosedTypeTestPlan,
  context: RustPlanContext,
): RustExpr | undefined {
  if (test.kind === "constant") return { kind: "evaluate-then", effect: expression, discard: "value",
    value: { kind: "bool-literal", value: test.value } };
  if (test.kind === "project") return planRustProjectTypeTest(node, expression, test.plan, context);
  if (context.syntheticNames === undefined) return undefined;
  if (test.kind === "option") {
    const name = allocateRustSyntheticName(context.syntheticNames, "instance");
    const body = planTest(node, { kind: "path", path: name }, test.element, test.test, context);
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
    const value = constant === undefined ? planTest(node, { kind: "path", path: name }, arm.carrier, arm.test, context)
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
