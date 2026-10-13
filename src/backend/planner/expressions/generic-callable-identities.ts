import type { Node } from "@tsonic/tsts";
import type { RustGenericCallableIdentityComparison } from "../../../analysis/callables/generic-identities.js";
import { rustCallableIdentityPredicate } from "../../target-ast/callable-identities.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planExpression } from "./entry.js";
import { rustReferenceToPlace } from "../../target-ast/expressions.js";

export function planRustGenericCallableIdentity(
  node: Node, selected: RustGenericCallableIdentityComparison, context: RustPlanContext,
): RustExpr | undefined {
  const leftType = rustTypeFromCarrierInContext(selected.leftCarrier, context);
  const rightType = rustTypeFromCarrierInContext(selected.rightCarrier, context);
  if (leftType?.kind !== "named" || rightType?.kind !== "named" ||
    context.input.program.callableValues.genericIdentities.forComparison(node) !== selected ||
    context.input.program.facts.getSelectedTargetOperator(node)?.operationId !== selected.operation.operationId) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.generic-callable-identity", "Native callable comparison requires its sealed identity selection and native type paths."));
    return undefined;
  }
  const stableLeft = context.input.program.valueLifetimes.canBorrowStableValue(selected.leftNode) ||
    context.input.program.borrowStability.canBorrowAcross(selected.leftNode, selected.rightNode);
  const left = planExpression(selected.leftNode, context, "value", stableLeft ? "shared-place" : "value");
  const right = planExpression(selected.rightNode, context, "value", "shared-place");
  if (left === undefined || right === undefined) return undefined;
  const stableRight = context.input.program.valueLifetimes.canBorrowStableValue(selected.rightNode) ||
    context.input.program.borrowStability.canBorrowAcross(selected.rightNode, selected.rightNode);
  const expression: RustExpr = { kind: "tuple-literal", elements: [
    stableLeft ? rustReferenceToPlace(left) : { kind: "reference", expr: left },
    stableRight ? rustReferenceToPlace(right) : { kind: "reference", expr: right },
  ] };
  if (selected.pairs.length === 0 || selected.exhaustive && selected.pairs.every(pair => pair.kind === "declaration")) {
    return { kind: "evaluate-then", effect: expression, discard: "value", value: {
      kind: "bool-literal", value: (selected.pairs.length !== 0) === (selected.operation.operator === "=="),
    } };
  }
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = selected.pairs.map(pair => {
    const pattern = (path: string, name: string): RustPattern => ({ kind: "tuple-variant", path,
      elements: [pair.kind === "declaration" ? { kind: "wildcard" } : { kind: "binding", name }],
    });
    const equality = rustCallableIdentityPredicate(pair.kind, { kind: "path", path: "left" }, { kind: "path", path: "right" });
    return { pattern: { kind: "tuple", elements: [
      pattern(`${leftType.path}::${pair.left.variantName}`, "left"),
      pattern(`${rightType.path}::${pair.right.variantName}`, "right"),
    ] }, expression: selected.operation.operator === "==" ? equality : { kind: "unary", operator: "!", operand: equality } };
  });
  if (!selected.exhaustive) arms.push({ pattern: { kind: "wildcard" },
    expression: { kind: "bool-literal", value: selected.operation.operator === "!=" } });
  return { kind: "match", expression, arms };
}
