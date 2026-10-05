import { rustValueBlock } from "../../target-ast/value-block.js";
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
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTargetOperationText } from "../../../analysis/facts/target-operation.js";
import { isRustCopyCarrier } from "../../../target-model/types/index.js";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustValueFieldLocation, rustSourceFieldHasValueReceiver } from "../objects/value-fields.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustAssignmentWrite } from "../statements/expression-statements.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { planExpression, planExpressionBeforeContextualConversion, planExpressionBeforeValueProjections } from "./entry.js";
import type { RustExpressionResultUse } from "./entry.js";
import { effectivePlannedExpressionCarrier, expressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "./fundamentals.js";
import { prepareRustComputedMemberEvaluation } from "./computed-members.js";
import { rustComputedMemberFactKey } from "../../../analysis/facts/operations/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { planRustOptionBranch } from "./option-branch.js";
import { planRustPresentValue } from "./optional-storage.js";

export function planNullishAssignment(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "nullish-assignment" }>,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  let left = BinaryExpression_Left(ast, node);
  const right = BinaryExpression_Right(ast, node);
  while (left !== undefined && ast.kindName(left) === KindParenthesizedExpression) {
    left = Node_Expression(ast, left);
  }
  if (left === undefined || right === undefined || context.syntheticNames === undefined ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.nullish-assignment-carrier") ||
    !selectedOperationMatches(context.input.program.facts.getSelectedTargetOperator(node),
      fact.operationId, "operator", fact.resultCarrier, rustTargetOperationText(fact))) {
    return undefined;
  }
  const evaluation = prepareRustComputedMemberEvaluation(left, context);
  if (evaluation === undefined) return undefined;
  if (evaluation.bindings.length !== 0) {
    const value = planNullishAssignment(node, fact, evaluation.context, resultUse);
    return value === undefined ? undefined : rustValueBlock(evaluation.bindings, value);
  }
  const names = context.syntheticNames;
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const overrides = new Map(context.expressionOverrides ?? []);
  const selectedContext = { ...context, expressionOverrides: overrides };
  const valueField = rustSourceFieldHasValueReceiver(left, context);
  const location = valueField
    ? planRustValueFieldLocation(left, context, "write")
    : undefined;
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
      ? ElementAccessExpression_ArgumentExpression(ast, left)
      : undefined;
    for (const operand of [receiver, index]) {
      if (operand === undefined || context.expressionOverrides?.has(operand)) continue;
      const value = planExpression(operand, context);
      const carrier = expressionCarrier(operand, context);
      if (value === undefined || carrier === undefined) return undefined;
      const name = allocateRustSyntheticName(names, operand === receiver ? "assignment_receiver" : "assignment_index");
      bindings.push({ name, value });
      overrides.set(operand, { expression: { kind: "path", path: name }, carrier, valueForm: "value" });
    }
  }
  const read = location?.read ?? planExpressionBeforeValueProjections(left, selectedContext, "value");
  if (read === undefined) return undefined;
  const unit: RustExpr = { kind: "tuple-literal", elements: [] };
  if (fact.presentResult === "identity") return rustValueBlock(bindings, resultUse === "value" ? read :
    { kind: "evaluate-then", effect: read, discard: "value", value: unit });
  const currentName = allocateRustSyntheticName(names, "assignment_current");
  bindings.push({ name: currentName, value: read });
  const value = rustTargetTypeRefEquals(fact.rightCarrier, effectivePlannedExpressionCarrier(right, context))
    ? planExpression(right, context) : planExpressionBeforeContextualConversion(right, context);
  if (value === undefined || resultUse === "value" && !isRustCopyCarrier(fact.rightCarrier) &&
    !requireRustCarrierRequirements(fact.rightCarrier, ["clone"], node, context)) return undefined;
  const valueName = allocateRustSyntheticName(names, "assignment_value");
  const valuePath: RustExpr = { kind: "path", path: valueName };
  overrides.set(right, {
    expression: resultUse === "discarded" || isRustCopyCarrier(fact.rightCarrier)
      ? valuePath : { kind: "method-call", receiver: valuePath, method: "clone", args: [] },
    carrier: fact.rightCarrier,
    valueForm: "value",
  });
  let writes: readonly RustStmt[] | undefined;
  if (location !== undefined) {
    const storedValue = planExpression(right, selectedContext);
    const written = storedValue === undefined ? undefined : location.write(storedValue, selectedContext);
    writes = written === undefined ? undefined : [{ kind: "expr", expr: written }];
  } else {
    writes = planRustAssignmentWrite(node, left, right, fact.assignment, selectedContext);
  }
  if (writes === undefined) return undefined;
  let assigned: RustExpr = resultUse === "value" ? valuePath : unit;
  for (const statement of [...writes].reverse()) {
    const effect = statement.kind === "expr" ? statement.expr
      : statement.kind === "assign" ? { ...statement, kind: "assignment" as const } : undefined;
    if (effect === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.nullish-assignment-write", "Nullish assignment requires an exact store in its conditional evaluation region."));
      return undefined;
    }
    assigned = { kind: "evaluate-then", effect, discard: "unit", value: assigned };
  }
  const presentName = allocateRustSyntheticName(names, "present_value");
  const present: RustExpr = { kind: "path", path: presentName };
  return rustValueBlock(bindings, planRustOptionBranch(
    { kind: "path", path: currentName }, fact.readCarrier, resultUse === "discarded" ? "_" : presentName,
    resultUse === "discarded" ? unit : fact.presentResult === "option"
      ? planRustPresentValue(fact.resultCarrier, present, context) : present,
    rustValueBlock([{ name: valueName, value }], assigned), context,
  ));
}
