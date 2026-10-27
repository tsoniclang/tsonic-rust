import type { Node } from "@tsonic/tsts";

import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustRuntimeSetExpression } from "./runtime-setters.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { planRustRuntimeWriteInputs } from "./runtime-index-inputs.js";
import { planRustUpdateValue } from "./update-target.js";

export function planRustRuntimeIndexUpdate(
  expression: Node,
  operand: Node,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  const write = context.input.program.records.compoundWrite.get(expression);
  if (write === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted runtime update requires its native setter and name scope.", expression);
  const inputs = planRustRuntimeWriteInputs(write, expression, "update", context);
  const selected = inputs.context;
  const overrides = new Map(selected.expressionOverrides);
  const read = planExpression(operand, selected);
  if (read === undefined) failRustPlannerInvariant("An admitted indexed update requires its native read operation.", operand);
  return planRustUpdateValue({
    locationBindings: inputs.bindings,
    read,
    write: value => {
      return planRustRuntimeSetExpression(expression, write, {
        ...selected,
        expressionOverrides: new Map(overrides).set(operand, {
          expression: value, carrier: update.resultCarrier, valueForm: "value",
        }),
      });
    },
    update, step, returnsPrevious, context,
  });
}
