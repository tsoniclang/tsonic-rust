import type { RustOptionEqualityView } from "../../../target-model/operations/option-equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustOptionPayloadView(expression: RustExpr, carrier: TargetTypeRef,
  view: Exclude<RustOptionEqualityView, "value">, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.typeEmission.get(carrier)?.optionPayload?.[view];
  if (selected === undefined) failRustPlannerInvariant("An admitted optional payload view requires its sealed native projection.", context.callableDeclaration ?? context.sourceFile);
  if (selected.kind === "identity") return expression;
  if (selected.kind === "leaf") return { kind: "method-call", receiver: expression, method: selected.method, args: [] };
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted optional projection requires its native name scope.", context.callableDeclaration ?? context.sourceFile);
  const name = allocateRustSyntheticName(context.syntheticNames, "option_value");
  return { kind: "method-call", receiver: { kind: "method-call", receiver: expression, method: "as_ref", args: [] }, method: "map",
    args: [{ kind: "closure", params: [{ name, byRefCopy: false }],
      body: planRustOptionPayloadView({ kind: "path", path: name }, selected.element, view, context) }] };
}
