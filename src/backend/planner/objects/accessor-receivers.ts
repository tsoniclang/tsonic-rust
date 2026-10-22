import type { Node } from "@tsonic/tsts";

import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "../expressions/entry.js";
import { planRustDirectStorage } from "../expressions/update-target.js";
import { directStorageRemainsSelected } from "../expressions/update-direct-storage.js";
import { planRustSharedReceiver } from "../expressions/typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export interface RustAccessorReceiverEvaluation {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }[];
  readonly receiver: RustExpr;
}

export function rustSourceAccessorHasValueReceiver(node: Node, context: RustPlanContext): boolean {
  return context.input.program.records.accessorReceiver.get(node)?.value === true;
}

export function planRustSourceAccessorReceiver(
  node: Node, laterExpressions: readonly Node[], context: RustPlanContext,
): RustAccessorReceiverEvaluation | undefined {
  const selected = context.input.program.records.accessorReceiver.get(node);
  if (selected === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted accessor requires its sealed receiver and native name scope.", node);
  const receiver = selected.receiver;
  const valueReceiver = selected.value;
  if (valueReceiver) {
    const direct = planRustDirectStorage(receiver, context);
    if (direct !== undefined) {
      if (!directStorageRemainsSelected(receiver, laterExpressions,
        context.expressionOverrides?.get(receiver)?.valueForm === "storage", context)) failRustPlannerInvariant("An admitted accessor requires its selected native receiver to remain stable.", node);
      return { bindings: [], receiver: direct };
    }
  }
  const value = planExpression(receiver, context);
  if (value === undefined) failRustPlannerInvariant("An admitted accessor requires its native receiver plan.", node);
  const name = allocateRustSyntheticName(context.syntheticNames, "accessor_receiver");
  return { bindings: [{ name, value: valueReceiver ? value : planRustSharedReceiver(receiver, value, context),
    ...(valueReceiver ? { mutable: true } : {}) }], receiver: { kind: "path", path: name } };
}
