import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  ElementAccessExpression_ArgumentExpression,
  KindElementAccessExpression,
  KindParenthesizedExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetOperationIsDirectLocation } from "../../../analysis/facts/target-operation.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustValueFieldLocation, rustSourceFieldHasValueReceiver } from "../objects/value-fields.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustCompoundAssignmentValue } from "../statements/assignments.js";
import type { RustAssignmentOperationFact } from "../statements/core.js";
import { planRustAssignmentWrite } from "../statements/expression-statements.js";
import { selectedOperatorMatches } from "../statements/iteration.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { planExpression } from "./entry.js";
import { expressionCarrier, requireExpressionCarrier } from "./fundamentals.js";
import { planRustDirectStorage } from "./updates/target.js";
import { prepareRustComputedMemberEvaluation } from "./computed-members.js";
import { rustComputedMemberFactKey } from "../../../analysis/facts/operations/keys.js";

export function planCompoundAssignmentExpression(
  node: Node,
  fact: RustAssignmentOperationFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  let left = BinaryExpression_Left(ast, node);
  const right = BinaryExpression_Right(ast, node);
  while (left !== undefined && ast.kindName(left) === KindParenthesizedExpression) {
    left = Node_Expression(ast, left);
  }
  if (left === undefined || right === undefined || context.syntheticNames === undefined ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.compound-assignment-carrier") ||
    !selectedOperatorMatches(node, fact, context)) return undefined;
  const evaluation = prepareRustComputedMemberEvaluation(left, context);
  if (evaluation === undefined) return undefined;
  if (evaluation.bindings.length !== 0) {
    const value = planCompoundAssignmentExpression(node, fact, evaluation.context);
    return value === undefined ? undefined : { kind: "block", bindings: evaluation.bindings, value };
  }
  const copy = isRustCopyCarrier(fact.resultCarrier);
  if (!copy && !requireRustCarrierRequirements(fact.resultCarrier, ["clone"], node, context)) return undefined;
  const names = context.syntheticNames;
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const overrides = new Map(context.expressionOverrides ?? []);
  const selected = { ...context, expressionOverrides: overrides };
  const valueField = rustSourceFieldHasValueReceiver(left, context);
  const location = valueField ? planRustValueFieldLocation(left, context, "write") : undefined;
  if (valueField && location === undefined) return undefined;
  if (location !== undefined) {
    bindings.push(...location.bindings);
  } else {
    const target = context.input.program.facts.getFact(left, rustTargetOperationFactKey);
    const staticReceiver = target?.kind === "source-static-field" ||
      target?.kind === "source-accessor" && target.receiver.kind === "static";
    const receiver = staticReceiver ? undefined : Node_Expression(ast, left);
    const index = context.input.program.facts.getFact(left, rustComputedMemberFactKey) === undefined &&
      ast.kindName(left) === KindElementAccessExpression
      ? ElementAccessExpression_ArgumentExpression(ast, left) : undefined;
    for (const operand of [receiver, index]) {
      if (operand === undefined || context.expressionOverrides?.has(operand)) continue;
      const storage = operand === receiver && rustTargetOperationIsDirectLocation(target)
        ? planRustDirectStorage(operand, context) : undefined;
      const value = storage === undefined
        ? planExpression(operand, context)
        : { kind: "reference" as const, expr: storage };
      const carrier = expressionCarrier(operand, context);
      if (value === undefined || carrier === undefined) return undefined;
      const name = allocateRustSyntheticName(names, operand === receiver ? "assignment_receiver" : "assignment_index");
      bindings.push({ name, value });
      overrides.set(operand, { expression: { kind: "path", path: name }, carrier,
        valueForm: storage === undefined ? "value" : "shared-reference" });
    }
  }
  const current = location?.read ?? planExpression(left, selected);
  const value = planExpression(right, context);
  if (current === undefined || value === undefined) return undefined;
  const currentName = allocateRustSyntheticName(names, "assignment_current");
  const valueName = allocateRustSyntheticName(names, "assignment_operand");
  const resultName = allocateRustSyntheticName(names, "assignment_result");
  const result: RustExpr = { kind: "path", path: resultName };
  const next = planRustCompoundAssignmentValue(fact, { kind: "path", path: currentName },
    { kind: "path", path: valueName }, node, context);
  if (next === undefined) return undefined;
  bindings.push({ name: currentName, value: current }, { name: valueName, value }, { name: resultName, value: next });
  const stored: RustExpr = copy ? result : { kind: "method-call", receiver: result, method: "clone", args: [] };
  overrides.set(right, { expression: stored, carrier: fact.resultCarrier, valueForm: "value" });
  const locationWrite = location?.write(stored);
  const writes = location === undefined
    ? planRustAssignmentWrite(node, left, right, { kind: "operator-token", operator: "=", resultCarrier: fact.resultCarrier }, selected)
    : locationWrite === undefined ? undefined : [{ kind: "expr" as const, expr: locationWrite }];
  if (writes === undefined) return undefined;
  let expression: RustExpr = result;
  for (const statement of [...writes].reverse()) {
    const effect: RustExpr | undefined = statement.kind === "expr" ? statement.expr
      : statement.kind === "assign" ? { ...statement, kind: "assignment" }
      : statement.kind === "index-assign" ? { kind: "assignment", operator: "=",
          target: { kind: "index", receiver: statement.receiver, index: statement.index }, value: statement.value }
      : undefined;
    if (effect === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.compound-assignment-write", "A compound assignment result requires its exact store in the same evaluation region."));
      return undefined;
    }
    expression = { kind: "evaluate-then", effect, discard: "unit", value: expression };
  }
  return { kind: "block", bindings, value: expression };
}
