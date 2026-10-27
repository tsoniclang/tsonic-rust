import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableIdentityComparison } from "../../../target-model/records/callables/generic-callables.js";
import { rustCallableIdentityPredicate } from "../../target-ast/syntax/callable-identities.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planExpression } from "./entry.js";

export function planRustGenericCallableIdentity(node: Node, _selected: RustGenericCallableIdentityComparison, context: RustPlanContext): RustExpr {
  const emission = context.input.program.records.genericIdentity.get(node)
    ?? failRustPlannerInvariant("An admitted native callable comparison requires its sealed identity emission.", node);
  const selected = emission.comparison;
  const leftType = rustTypeFromCarrierInContext(selected.leftCarrier, context);
  const rightType = rustTypeFromCarrierInContext(selected.rightCarrier, context);
  if (leftType?.kind !== "named" || rightType?.kind !== "named")
    failRustPlannerInvariant("An admitted native callable comparison requires its native type paths.", node);
  const left = planExpression(selected.leftNode, context, "value", emission.stableLeft ? "shared-reference" : "value")
    ?? failRustPlannerInvariant("An admitted callable comparison requires its native left operand.", selected.leftNode);
  const right = planExpression(selected.rightNode, context, "value", emission.stableRight ? "shared-reference" : "shared-place")
    ?? failRustPlannerInvariant("An admitted callable comparison requires its native right operand.", selected.rightNode);
  const expression: RustExpr = { kind: "tuple-literal", elements: [
    emission.stableLeft ? left : { kind: "reference", expr: left },
    emission.stableRight ? right : { kind: "reference", expr: right },
  ] };
  if (emission.constant !== undefined) return { kind: "evaluate-then", effect: expression, discard: "value",
    value: { kind: "bool-literal", value: emission.constant } };
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = selected.pairs.map(pair => {
    const pattern = (path: string, name: string): RustPattern => ({ kind: "tuple-variant", path,
      elements: [pair.kind === "declaration" ? { kind: "wildcard" } : { kind: "binding", name }] });
    const equality = rustCallableIdentityPredicate(pair.kind, { kind: "path", path: "left" }, { kind: "path", path: "right" });
    return { pattern: { kind: "tuple", elements: [pattern(`${leftType.path}::${pair.left.variantName}`, "left"),
      pattern(`${rightType.path}::${pair.right.variantName}`, "right")] },
      expression: selected.operation.operator === "==" ? equality : { kind: "unary", operator: "!", operand: equality } };
  });
  if (!selected.exhaustive) arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "bool-literal", value: selected.operation.operator === "!=" } });
  return { kind: "match", expression, arms };
}
