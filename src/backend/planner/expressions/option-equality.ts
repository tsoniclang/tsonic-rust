import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustOptionEqualityView } from "../../../target-model/operations/option-equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpressionBeforeOptionProjection, planExpressionBeforeValueProjections } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { planRustStringComparisonView } from "./string-comparison-views.js";
import { planRustOptionPayloadView } from "./option-payload-views.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

function operand(node: Node, later: Node | undefined, carrier: TargetTypeRef, view: RustOptionEqualityView,
  liftDepth: number, rawOption: boolean, option: boolean, context: RustPlanContext): RustExpr {
  const value = (rawOption ? planExpressionBeforeValueProjections(node, context, "value") : planExpressionBeforeOptionProjection(node, context))
    ?? failRustPlannerInvariant("An admitted optional equality requires its native source operand.", node);
  let selected: RustExpr | undefined = view === "str" ? planRustStringComparisonView(node, value, carrier, later, context)
    : view === "shared" ? option ? planRustOptionPayloadView(value, carrier, view, context)
      : planRustSharedReceiver(node, value, context, later) : value;
  if (selected === undefined) failRustPlannerInvariant("An admitted optional equality requires its native borrowed payload view.", node);
  for (let depth = 0; depth < liftDepth; depth++) selected = { kind: "call", path: "Some", args: [selected] };
  return selected;
}

export function planRustOptionEquality(node: Node,
  _fact: Extract<RustTargetOperationFact, { readonly kind: "option-equality" }>, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.optionEquality.get(node)
    ?? failRustPlannerInvariant("An admitted optional equality requires its selected native operands and borrowed views.", node);
  const fact = selected.fact;
  const compare = (left: RustExpr): RustExpr => {
    const right = operand(selected.right, undefined, fact.rightCarrier, fact.view, fact.rightLiftDepth, selected.rightRawOption, selected.rightOption, context);
    return { kind: "binary", operator: fact.negated ? "!=" : "==", left, right };
  };
  if (selected.precedingAcquisition !== undefined) {
    const source = planExpressionBeforeValueProjections(selected.left, context, "value", "shared-place")
      ?? failRustPlannerInvariant("An admitted optional comparison requires its selected native acquisition.", selected.left);
    if (context.syntheticNames === undefined || fact.view === "value")
      failRustPlannerInvariant("An admitted optional acquisition requires its borrowed view and native scope.", node);
    const name = allocateRustSyntheticName(context.syntheticNames, "option_snapshot");
    const value = selected.precedingAcquisition.kind === "clone" ? cloneRustExpression(source) : source;
    let left = planRustOptionPayloadView({ kind: "path", path: name }, fact.leftCarrier, fact.view, context);
    for (let depth = 0; depth < fact.leftLiftDepth; depth++) left = { kind: "call", path: "Some", args: [left] };
    return rustValueBlock([{ name, value }], compare(left));
  }
  const left = operand(selected.left, selected.right, fact.leftCarrier, fact.view, fact.leftLiftDepth, selected.leftRawOption, selected.leftOption, context);
  return compare(left);
}
