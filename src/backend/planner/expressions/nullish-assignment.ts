import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpressionResultUse } from "./entry.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustValueFieldLocation } from "../objects/value-fields.js";
import { planRustAssignmentWrite } from "../statements/assignment-writes.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { planExpression, planExpressionBeforeContextualConversion, planExpressionBeforeValueProjections } from "./entry.js";
import { prepareRustComputedMemberEvaluation } from "./computed-members.js";
import { planRustOptionBranch } from "./option-branch.js";
import { planRustPresentValue } from "./optional-storage.js";

export function planNullishAssignment(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse): RustExpr | undefined {
  const selected = context.input.program.records.assignmentEvaluation.get(node);
  if (selected?.kind !== "nullish" || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted nullish assignment requires its native evaluation plan and hygienic scope.", node);
  const { left, right, fact, copy } = selected;
  const evaluation = prepareRustComputedMemberEvaluation(left, context);
  if (evaluation === undefined) return undefined;
  if (evaluation.bindings.length !== 0) {
    const value = planNullishAssignment(node, evaluation.context, resultUse);
    return value === undefined ? undefined : rustValueBlock(evaluation.bindings, value);
  }
  const names = context.syntheticNames;
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const overrides = new Map(context.expressionOverrides ?? []);
  const scoped = { ...context, expressionOverrides: overrides };
  const location = selected.valueField ? planRustValueFieldLocation(left, context, "write") : undefined;
  if (selected.valueField && location === undefined) failRustPlannerInvariant("An admitted nullish field write requires its selected native location.", left);
  if (location !== undefined) bindings.push(...location.bindings);
  else for (const operand of selected.operands) {
    if (context.expressionOverrides?.has(operand.node)) continue;
    const value = planExpression(operand.node, context);
    if (value === undefined) return undefined;
    const name = allocateRustSyntheticName(names, operand.role === "receiver" ? "assignment_receiver" : "assignment_index");
    bindings.push({ name, value });
    overrides.set(operand.node, { expression: { kind: "path", path: name }, carrier: operand.carrier, valueForm: "value" });
  }
  const read = location?.read ?? planExpressionBeforeValueProjections(left, scoped, "value");
  if (read === undefined) return undefined;
  const unit: RustExpr = { kind: "tuple-literal", elements: [] };
  if (fact.presentResult === "identity") return rustValueBlock(bindings, resultUse === "value" ? read
    : { kind: "evaluate-then", effect: read, discard: "value", value: unit });
  const currentName = allocateRustSyntheticName(names, "assignment_current");
  bindings.push({ name: currentName, value: read });
  const value = selected.rightForm === "value" ? planExpression(right, context) : planExpressionBeforeContextualConversion(right, context);
  if (value === undefined || resultUse === "value" && !copy && !requireRustCarrierRequirements(fact.rightCarrier, ["clone"], node, context)) return undefined;
  const valueName = allocateRustSyntheticName(names, "assignment_value");
  const valuePath: RustExpr = { kind: "path", path: valueName };
  overrides.set(right, { expression: resultUse === "discarded" || copy ? valuePath : { kind: "method-call", receiver: valuePath, method: "clone", args: [] },
    carrier: fact.rightCarrier, valueForm: "value" });
  let writes: readonly RustStmt[] | undefined;
  if (location === undefined) writes = planRustAssignmentWrite(node, left, right, fact.assignment, scoped);
  else {
    const stored = planExpression(right, scoped);
    const written = stored === undefined ? undefined : location.write(stored, scoped);
    writes = written === undefined ? undefined : [{ kind: "expr", expr: written }];
  }
  if (writes === undefined) return undefined;
  const assigned: RustExpr = { kind: "block", body: { statements: [...writes, { kind: "tail", expr: resultUse === "value" ? valuePath : unit }] } };
  const presentName = allocateRustSyntheticName(names, "present_value");
  const present: RustExpr = { kind: "path", path: presentName };
  return rustValueBlock(bindings, planRustOptionBranch({ kind: "path", path: currentName }, fact.readCarrier, resultUse === "discarded" ? "_" : presentName,
    resultUse === "discarded" ? unit : fact.presentResult === "option" ? planRustPresentValue(fact.resultCarrier, present, context) : present,
    rustValueBlock([{ name: valueName, value }], assigned), context));
}
