import { isRustOptionCarrier, rustOptionElementCarrier, rustOptionValueCarrier } from "../../../target-model/types/carriers/optional.js";
import { isRustStringCarrier } from "../../../target-model/types/carriers/js.js";
import type { RustOptionEqualityView } from "../../../target-model/operations/option-equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

export function planRustOptionPayloadView(
  expression: RustExpr, carrier: TargetTypeRef, view: Exclude<RustOptionEqualityView, "value">, context: RustPlanContext,
): RustExpr {
  if (view === "str" && !isRustStringCarrier(rustOptionValueCarrier(carrier))) return expression;
  const element = rustOptionElementCarrier(carrier)!;
  if (!isRustOptionCarrier(element)) {
    return { kind: "method-call", receiver: expression, method: view === "str" ? "as_deref" : "as_ref", args: [] };
  }
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile, []);
  const name = allocateRustSyntheticName(names, "option_value");
  return {
    kind: "method-call",
    receiver: { kind: "method-call", receiver: expression, method: "as_ref", args: [] },
    method: "map",
    args: [{ kind: "closure", params: [{ name, byRefCopy: false }],
      body: planRustOptionPayloadView({ kind: "path", path: name }, element, view, context) }],
  };
}
