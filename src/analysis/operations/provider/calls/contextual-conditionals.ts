import type { Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution.js";
import { selectRustValueCarrierReconciliation } from "../../../../policy/types/value-carrier-reconciliation.js";
import { rustEffectiveValueCarrier } from "../../../facts/value-carrier-queries.js";
import type { RustOperationsProviderOptions } from "../model.js";

export function contextualConditionalArgumentMatches(
  expression: Node,
  expected: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): boolean {
  const pending = [expression];
  let conditional = false;
  while (pending.length > 0) {
    const node = pending.pop()!;
    const parenthesized = context.ast.is.IsParenthesizedExpression(node);
    if (parenthesized || context.ast.is.IsSatisfiesExpression(node)) {
      const inner = parenthesized ? context.ast.as.AsParenthesizedExpression(node)?.Expression
        : context.ast.as.AsSatisfiesExpression(node)?.Expression;
      if (inner === undefined) return false;
      pending.push(inner);
      continue;
    }
    if (context.ast.is.IsConditionalExpression(node)) {
      const parts = context.ast.as.AsConditionalExpression(node);
      if (parts?.WhenTrue === undefined || parts.WhenFalse === undefined) return false;
      conditional = true;
      pending.push(parts.WhenTrue, parts.WhenFalse);
      continue;
    }
    if (!conditional) return false;
    const carrier = rustEffectiveValueCarrier(context.facts, node) ??
      resolveRustTargetTypeRef(node, context, options);
    if (carrier === undefined || !rustTargetTypeRefEquals(carrier, expected) &&
      selectRustValueCarrierReconciliation(carrier, expected, options.projectTypes,
        context.typeDefinitions).kind === "incompatible") return false;
  }
  return conditional;
}
