import type { Node } from "@tsonic/tsts";
import {
  isRustNativeFutureCarrier,
  isRustUnitCarrier,
  rustOptionElementCarrier,
} from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { expressionCarrier } from "./fundamentals.js";
import { rustExpressionReadsStorage } from "./typed-locations.js";

export interface RustDiscardedValue {
  readonly expression: RustExpr;
  readonly discard: "unit" | "value";
}

export function planRustDiscardedValue(
  node: Node,
  context: RustPlanContext,
): RustDiscardedValue | undefined {
  const carrier = expressionCarrier(node, context);
  const nativeFuture = isRustNativeFutureCarrier(rustOptionElementCarrier(carrier) ?? carrier);
  if (rustExpressionReadsStorage(node, context)) {
    const expression = planExpression(node, context, "value", "shared-reference");
    return expression === undefined ? undefined : { expression, discard: "value" };
  }
  const expression = planExpression(node, context, "discarded");
  if (expression === undefined) return undefined;
  return nativeFuture
    ? { expression: { kind: "call", path: "core::mem::drop", args: [expression] }, discard: "unit" }
    : { expression, discard: isRustUnitCarrier(carrier) ? "unit" : "value" };
}
