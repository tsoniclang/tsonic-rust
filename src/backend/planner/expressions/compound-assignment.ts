import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustValueFieldLocation } from "../objects/value-fields.js";
import { planRustCompoundAssignmentValue } from "../statements/assignments.js";
import { planRustAssignmentWrite } from "../statements/assignment-writes.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustWriteLivenessAttributes } from "../bindings/liveness.js";
import { planExpression } from "./entry.js";
import { planRustDirectStorage } from "./update-target.js";
import { prepareRustComputedMemberEvaluation } from "./computed-members.js";

export function planCompoundAssignmentExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.assignmentEvaluation.get(node);
  if (selected?.kind !== "compound" || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted compound assignment requires its native evaluation plan and hygienic scope.", node);
  const { left, right, fact, copy } = selected;
  const evaluation = prepareRustComputedMemberEvaluation(left, context);
  if (evaluation === undefined) return undefined;
  if (evaluation.bindings.length !== 0) {
    const value = planCompoundAssignmentExpression(node, evaluation.context);
    return value === undefined ? undefined : rustValueBlock(evaluation.bindings, value);
  }
  if (!copy && !requireRustCarrierRequirements(fact.resultCarrier, ["clone"], node, context)) return undefined;
  const names = context.syntheticNames;
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const overrides = new Map(context.expressionOverrides ?? []);
  const scoped = { ...context, expressionOverrides: overrides };
  const location = selected.valueField ? planRustValueFieldLocation(left, context, "write") : undefined;
  if (selected.valueField && location === undefined) failRustPlannerInvariant("An admitted compound field write requires its native location.", left);
  if (location !== undefined) bindings.push(...location.bindings);
  else for (const operand of selected.operands) {
    if (context.expressionOverrides?.has(operand.node)) continue;
    if (operand.storage === "direct-identifier") {
      const expression = planRustDirectStorage(operand.node, context)
        ?? failRustPlannerInvariant("An admitted assignment storage operand requires its native place.", operand.node);
      overrides.set(operand.node, { expression, carrier: operand.carrier, valueForm: "storage", storageForm: "plain" });
      continue;
    }
    const storage = operand.storage === "direct" ? planRustDirectStorage(operand.node, context) : undefined;
    if (operand.storage === "direct" && storage === undefined) failRustPlannerInvariant("An admitted native assignment receiver requires its direct place.", operand.node);
    const value = storage === undefined ? planExpression(operand.node, context) : { kind: "reference" as const, expr: storage };
    if (value === undefined) return undefined;
    const name = allocateRustSyntheticName(names, operand.role === "receiver" ? "assignment_receiver" : "assignment_index");
    bindings.push({ name, value });
    overrides.set(operand.node, { expression: { kind: "path", path: name }, carrier: operand.carrier, valueForm: storage === undefined ? "value" : "shared-reference" });
  }
  const current = location?.read ?? planExpression(left, scoped);
  const value = planExpression(right, context);
  if (current === undefined || value === undefined) return undefined;
  const currentName = allocateRustSyntheticName(names, "assignment_current");
  const valueName = allocateRustSyntheticName(names, "assignment_operand");
  const resultName = allocateRustSyntheticName(names, "assignment_result");
  const result: RustExpr = { kind: "path", path: resultName };
  const next = planRustCompoundAssignmentValue(fact, { kind: "path", path: currentName }, { kind: "path", path: valueName }, node, context);
  if (next === undefined) return undefined;
  bindings.push({ name: currentName, value: current }, { name: valueName, value }, { name: resultName, value: next });
  const stored: RustExpr = copy ? result : { kind: "method-call", receiver: result, method: "clone", args: [] };
  overrides.set(right, { expression: stored, carrier: fact.resultCarrier, valueForm: "value" });
  const written = location?.write(stored, context);
  const writes = location === undefined ? planRustAssignmentWrite(node, left, right, { kind: "operator-token", operator: "=", resultCarrier: fact.resultCarrier,
    operandModes: ["mut-ref", "value"] }, scoped) : written === undefined ? undefined : [{ kind: "expr" as const, expr: written }];
  return writes === undefined ? undefined : rustValueBlock(bindings, { kind: "block", body: {
    innerAttrs: rustWriteLivenessAttributes(left, context), statements: [...writes, { kind: "tail", expr: result }] } });
}
