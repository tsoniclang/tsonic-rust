import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "../expressions/entry.js";
import { effectivePlannedExpressionCarrier } from "../expressions/fundamentals.js";
import { planRustDirectStorage } from "../expressions/updates/target.js";
import { directStorageRemainsSelected } from "../expressions/updates/direct-storage.js";
import { planRustSharedReceiver } from "../expressions/typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustProjectObjectRepresentation } from "./project-storage.js";

export interface RustAccessorReceiverEvaluation {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }[];
  readonly receiver: RustExpr;
}

export function rustSourceAccessorHasValueReceiver(node: Node, context: RustPlanContext): boolean {
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  const receiver = Node_Expression(context.input.program.source.ast, node);
  const carrier = receiver === undefined ? undefined : effectivePlannedExpressionCarrier(receiver, context);
  return operation?.kind === "source-accessor" && operation.receiver.kind === "instance" &&
    carrier !== undefined && rustProjectObjectRepresentation(carrier, context)?.kind === "value";
}

export function planRustSourceAccessorReceiver(
  node: Node, laterExpressions: readonly Node[], context: RustPlanContext,
): RustAccessorReceiverEvaluation | undefined {
  const receiver = Node_Expression(context.input.program.source.ast, node);
  if (receiver === undefined || context.syntheticNames === undefined) return undefined;
  const valueReceiver = rustSourceAccessorHasValueReceiver(node, context);
  if (valueReceiver) {
    const direct = planRustDirectStorage(receiver, context);
    if (direct !== undefined) {
      if (!directStorageRemainsSelected(receiver, laterExpressions,
        context.expressionOverrides?.get(receiver)?.valueForm === "storage", context)) return undefined;
      return { bindings: [], receiver: direct };
    }
  }
  const value = planExpression(receiver, context);
  if (value === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "accessor_receiver");
  return { bindings: [{ name, value: valueReceiver ? value : planRustSharedReceiver(receiver, value, context),
    ...(valueReceiver ? { mutable: true } : {}) }], receiver: { kind: "path", path: name } };
}
