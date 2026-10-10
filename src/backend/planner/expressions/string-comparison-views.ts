import type { Node } from "@tsonic/tsts";
import { isRustOptionCarrier } from "../../../target-model/types/carriers/optional.js";
import { isRustStringCarrier } from "../../../target-model/types/carriers/js.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustOptionPayloadView } from "./option-payload-views.js";
import { rustErrorFieldBorrowNeedsSnapshot, rustErrorFieldComparisonView, rustErrorFieldOptionalView, rustErrorFieldSharedView } from "./error-field-borrows.js";
import { rustStringToBorrowedStrValueConversion } from "../../../target-model/conversions/model.js";
import { applyRustValueConversion } from "./value-conversions.js";

export function planRustStringComparisonView(
  node: Node, expression: RustExpr, carrier: TargetTypeRef, later: Node | undefined, context: RustPlanContext,
): RustExpr | undefined {
  if (isRustOptionCarrier(carrier)) {
    const read = later !== undefined && rustErrorFieldBorrowNeedsSnapshot(node, [later], context)
      ? expression : rustErrorFieldOptionalView(node, expression, context);
    return planRustOptionPayloadView(read, carrier, "str", context);
  }
  if (!isRustStringCarrier(carrier)) return expression;
  const value = rustErrorFieldComparisonView(node, expression, later, context);
  if (value.kind === "string-literal") return { kind: "str-literal", value: value.value };
  if (value.kind === "str-literal") return value;
  const guarded = rustErrorFieldSharedView(node, expression, context);
  if (guarded !== undefined && expression.kind === "owned-string-from-borrowed-str" && value === expression.expression) {
    return guarded;
  }
  return applyRustValueConversion(context, value, rustStringToBorrowedStrValueConversion, node, false);
}
