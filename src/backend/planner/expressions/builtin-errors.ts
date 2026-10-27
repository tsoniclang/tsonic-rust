import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustCurrentErrorBoundary, type RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression, planExpressionBeforeValueProjections } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";

export function planRustBuiltinErrorProperty(node: Node,
  _fact: Extract<RustTargetOperationFact, { readonly kind: "builtin-error-property" }>, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.errorFieldEmission.get(node);
  if (selected?.kind !== "property") failRustPlannerInvariant("An admitted Error property requires its native observation plan.", node);
  const read = planRustBuiltinErrorPropertyRead(node, context);
  return selected.property === "stack" ? { kind: "method-call", receiver: read, method: "map", args: [{ kind: "path", path: "String::from" }] }
    : { kind: "owned-string-from-borrowed-str", expression: read };
}

export function planRustBuiltinErrorPropertyRead(node: Node, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.errorFieldEmission.get(node);
  if (selected?.kind !== "property") failRustPlannerInvariant("An admitted Error property requires its exact native observation plan.", node);
  const receiver = (selected.receiverForm === "direct" ? planExpression(selected.receiver, context)
    : planExpressionBeforeValueProjections(selected.receiver, context, "value"))
    ?? failRustPlannerInvariant("An admitted Error observation requires its native receiver.", selected.receiver);
  if (selected.receiverForm === "direct") return { kind: "call", path: `rt::ErrorObject::error_${selected.property}`,
    args: [planRustSharedReceiver(selected.receiver, receiver, context)] };
  const boundary = selected.receiverForm === "program" ? rustCurrentErrorBoundary(context) : undefined;
  if (selected.receiverForm === "program" && boundary === undefined)
    failRustPlannerInvariant("An admitted Error observation requires its exact native error domain.", node);
  const observed: RustExpr = { kind: "method-call", receiver, method: selected.receiverForm === "closed" ? "as_error" : "source_error", args: [] };
  const borrowed: RustExpr = boundary?.errorDomain === "runtime" ? observed : { kind: "method-call", receiver: observed,
    method: "expect", args: [{ kind: "str-literal", value: "exact checked flow selected a non-Error observation" }] };
  return { kind: "call", path: `tsonic_rust_runtime::ErrorObject::error_${selected.property}`, args: [borrowed] };
}
