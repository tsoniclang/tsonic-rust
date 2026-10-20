import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpressionAsStatement } from "../statements/statement-simple.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planExpressionBeforeContextualConversion } from "./entry.js";

export function planAssignmentExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.assignmentWrite.get(node);
  if (selected?.valueResult === undefined) failRustPlannerInvariant("An admitted value assignment requires its exact native right-hand completion.", node);
  const right = selected.value;
  const { carrier, copy } = selected.valueResult;
  const type = rustTypeFromCarrierInContext(carrier, context);
  if (type === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted value assignment requires its native result type and hygienic scope.", node);
  if (!copy && !requireRustCarrierRequirements(carrier, ["clone"], node, context)) {
    return undefined;
  }
  const value = planExpressionBeforeContextualConversion(right, context);
  if (value === undefined) return undefined;
  const resultName = allocateRustSyntheticName(context.syntheticNames, "assignment_result");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "assignment_value");
  const result: RustExpr = { kind: "path", path: resultName };
  const operand: RustExpr = { kind: "path", path: valueName };
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(right, {
    carrier,
    valueForm: "value",
    expression: rustValueBlock([{ name: valueName, value }], {
        kind: "evaluate-then",
        effect: {
          kind: "assignment", operator: "=", target: result,
          value: copy ? operand : { kind: "method-call", receiver: operand, method: "clone", args: [] },
        },
        discard: "unit",
        value: operand,
      }),
  });
  const statements = planExpressionAsStatement(node, { ...context, expressionOverrides: overrides });
  if (statements === undefined) return undefined;
  return rustValueBlock([{ name: resultName, type }], {
    kind: "block",
    body: { statements: [...statements, { kind: "tail", expr: result }] },
  });
}
