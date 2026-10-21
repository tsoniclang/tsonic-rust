import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustOptionPayloadView } from "./option-payload-views.js";
import { rustErrorFieldBorrowNeedsSnapshot, rustErrorFieldComparisonView, rustErrorFieldOptionalView } from "./error-field-borrows.js";

export function planRustStringComparisonView(node: Node, expression: RustExpr, carrier: TargetTypeRef,
  later: Node | undefined, context: RustPlanContext): RustExpr {
  const type = context.input.program.records.typeEmission.get(carrier)
    ?? failRustPlannerInvariant("An admitted string comparison requires its native storage view.", node);
  const snapshot = later !== undefined && rustErrorFieldBorrowNeedsSnapshot(node, [later], context);
  if (type.option) return planRustOptionPayloadView(snapshot ? expression : rustErrorFieldOptionalView(node, expression, context), carrier, "str", context);
  if (!type.string) return expression;
  const value = rustErrorFieldComparisonView(node, expression, later, context);
  const selected = context.input.program.records.stringComparisonView.get(node)
    ?? failRustPlannerInvariant("An admitted string comparison requires its selected native borrowing form.", node);
  if (!snapshot && selected.kind !== "value" && context.expressionOverrides?.has(node) !== true) return value;
  return { kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [{ kind: "reference", expr: value }] };
}
