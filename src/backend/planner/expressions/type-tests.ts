import { rustAutoBorrowedReceiver } from "./auto-borrowed-receivers.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustClosedTypeTestEmission } from "../../../target-model/records/types/type-tests.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "./entry.js";
import { planRustUnionPattern } from "./union-patterns.js";
import { planRustProjectTypeTest } from "../objects/project-downcasts.js";

export function planRustClosedTypeTest(node: Node,
  _fact: Extract<RustTargetOperationFact, { readonly kind: "closed-type-test" }>, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.closedTypeTestEmission.get(node)
    ?? failRustPlannerInvariant("An admitted type predicate requires its native emission plan.", node);
  const expression = planExpression(selected.operand, context, "value", "shared-reference")
    ?? failRustPlannerInvariant("An admitted type predicate requires its native operand.", selected.operand);
  return planTest(node, expression, selected.test, context);
}

function planTest(node: Node, expression: RustExpr, test: RustClosedTypeTestEmission, context: RustPlanContext): RustExpr {
  if (test.kind === "constant") return { kind: "evaluate-then", effect: expression, discard: "value", value: { kind: "bool-literal", value: test.value } };
  if (test.kind === "runtime-array") {
    context.usedAliases?.add("js_abi");
    return { kind: "call", path: "js_abi::array_is_array_value", args: [expression] };
  }
  if (test.kind === "project") return planRustProjectTypeTest(node, expression, test.plan, context)
    ?? failRustPlannerInvariant("An admitted project type test requires its native dispatch.", node);
  if (test.kind === "error") {
    if (test.errorKind === "any") return { kind: "method-call", receiver: rustAutoBorrowedReceiver(expression), method: "is_error", args: [] };
    context.usedAliases?.add("rt");
    const kind: RustExpr = { kind: "path", path: `rt::JsErrorKind::${test.errorKind}` };
    return test.lowering === "native-error" ? { kind: "binary", left: { kind: "call", path: "rt::ErrorObject::error_kind", args: [expression] }, operator: "==", right: kind }
      : { kind: "method-call", receiver: rustAutoBorrowedReceiver(expression), method: "is_error_kind", args: [kind] };
  }
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted type test requires its native binding scope.", node);
  if (test.kind === "option") {
    const name = allocateRustSyntheticName(names, "instance");
    return { kind: "method-call", receiver: { kind: "method-call", receiver: rustAutoBorrowedReceiver(expression), method: "as_ref", args: [] }, method: "is_some_and",
      args: [{ kind: "closure", params: [{ name, byRefCopy: false }], body: planTest(node, { kind: "path", path: name }, test.test, context) }] };
  }
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const arm of test.arms) {
    const name = allocateRustSyntheticName(names, "instance");
    const pattern = planRustUnionPattern([{ union: test.carrier, variant: arm.variant }], arm.test.kind === "constant" ? { kind: "wildcard" } : { kind: "binding", name }, context)
      ?? failRustPlannerInvariant("An admitted type-test arm requires its native pattern.", node);
    arms.push({ pattern, expression: arm.test.kind === "constant" ? { kind: "bool-literal", value: arm.test.value }
      : planTest(node, { kind: "path", path: name }, arm.test, context) });
  }
  return test.form === "matches" ? { kind: "matches", expression,
    pattern: arms.length === 1 ? arms[0]!.pattern : { kind: "or", alternatives: arms.map(arm => arm.pattern) } }
    : { kind: "match", expression, arms };
}
