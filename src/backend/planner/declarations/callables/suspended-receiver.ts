import type { RustSuspendedOwnedReceiver } from "../../../../target-model/records/callables/callables-and-resources.js";
import type { RustEffectiveExpressionOverride, RustPlanContext } from "../../program/plan-context.js";
import type { RustStmt } from "../../../target-ast/syntax/nodes.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustSuspendedReceiver(
  receiver: RustSuspendedOwnedReceiver | undefined,
  context: RustPlanContext,
): { readonly context: RustPlanContext; readonly prelude: readonly RustStmt[] } {
  if (receiver === undefined || receiver.occurrences.every(node => context.expressionOverrides?.has(node))) {
    return { context, prelude: [] };
  }
  if (context.syntheticNames === undefined)
    failRustPlannerInvariant("Suspended receiver planning requires a native name scope.");
  const name = allocateRustSyntheticName(context.syntheticNames, "receiver");
  const overrides = new Map(context.expressionOverrides);
  const override: RustEffectiveExpressionOverride = {
    expression: { kind: "path", path: name }, carrier: receiver.carrier, valueForm: "storage", storageForm: "plain",
  };
  for (const node of receiver.occurrences) overrides.set(node, override);
  return {
    context: { ...context, expressionOverrides: overrides },
    prelude: [{ kind: "let", name, mutable: false,
      init: { kind: "method-call", receiver: { kind: "path", path: "self" }, method: "clone", args: [] } }],
  };
}
