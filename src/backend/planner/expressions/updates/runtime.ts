import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustCompoundWriteFactKey } from "../../../../analysis/facts/operations/keys.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";
import type { RustExpr } from "../../../target-ast/nodes.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { planRuntimeSetStatement } from "../../statements/iteration.js";
import { planExpression } from "../entry.js";
import { expressionCarrier } from "../fundamentals.js";
import { planRustUpdateValue } from "./target.js";

export function planRustRuntimeIndexUpdate(
  expression: Node,
  operand: Node,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  const write = context.input.program.facts.getFact(expression, rustCompoundWriteFactKey);
  const { ast } = context.input.program.source;
  const receiver = Node_Expression(ast, operand);
  const index = ElementAccessExpression_ArgumentExpression(ast, operand);
  if (write === undefined || receiver === undefined || index === undefined || context.syntheticNames === undefined) return undefined;
  const bindings: { name: string; value: RustExpr }[] = [];
  const overrides = new Map(context.expressionOverrides ?? []);
  for (const [subject, base] of [[receiver, "update_receiver"], [index, "update_index"]] as const) {
    const value = planExpression(subject, context);
    const carrier = expressionCarrier(subject, context);
    if (value === undefined || carrier === undefined) return undefined;
    const name = allocateRustSyntheticName(context.syntheticNames, base);
    bindings.push({ name, value });
    overrides.set(subject, { expression: { kind: "path", path: name }, carrier, valueForm: "value" });
  }
  const selected = { ...context, expressionOverrides: overrides };
  const read = planExpression(operand, selected);
  if (read === undefined) return undefined;
  return planRustUpdateValue({
    locationBindings: bindings,
    read,
    write: value => {
      const written = planRuntimeSetStatement(expression, write, {
        ...selected,
        expressionOverrides: new Map(overrides).set(operand, {
          expression: value, carrier: update.resultCarrier, valueForm: "value",
        }),
      }, { target: operand, value: operand });
      const statement = written?.length === 1 ? written[0] : undefined;
      return statement?.kind === "expr" ? statement.expr
        : statement?.kind === "index-assign" ? {
          kind: "assignment", operator: "=",
          target: { kind: "index", receiver: statement.receiver, index: statement.index },
          value: statement.value,
        } : undefined;
    },
    update, step, returnsPrevious, context,
  });
}
