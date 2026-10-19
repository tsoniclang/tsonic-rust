import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceExpressionSequence } from "@tsonic/target-api/source";
import type { RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planExpression } from "../expressions/entry.js";
import { planRustDiscardedValue } from "../expressions/discarded-values.js";
import { planRuntimeSetStatement } from "./statement-loops.js";
import { planRustAssignmentWrite } from "./assignment-writes.js";

export function planExpressionStatement(node: Node, context: RustPlanContext): readonly RustStmt[] {
  const expression = Node_Expression(context.input.program.source.ast, node);
  if (expression === undefined) failRustPlannerInvariant("An admitted expression statement requires its source expression.", node);
  return planExpressionAsStatement(expression, context);
}

export function planExpressionAsStatement(expression: Node, context: RustPlanContext): readonly RustStmt[] {
  const { records } = context.input.program;
  if (records.compileTimeSource.get(expression) !== undefined) return [];
  const sequence = sourceExpressionSequence(context.input.program.source.ast, expression);
  if (sequence.length > 1) return sequence.flatMap(item => planExpressionAsStatement(item, context));
  const operation = records.targetOperation.get(expression);
  if (operation?.kind === "runtime-set") {
    const statements = planRuntimeSetStatement(expression, operation, context);
    if (statements === undefined) failRustPlannerInvariant("An admitted assignment requires its native setter plan.", expression);
    return statements;
  }
  const assignment = records.assignmentCompletion.get(expression);
  const completion = records.assignmentWrite.get(expression);
  if (assignment !== undefined && context.input.program.source.ast.is.IsBinaryExpression(expression)) {
    if (completion === undefined) failRustPlannerInvariant("An admitted assignment requires its sealed write completion.", expression);
    const statements = planRustAssignmentWrite(expression, completion.target, completion.value, assignment, context);
    if (statements === undefined) failRustPlannerInvariant("An admitted assignment requires its native write plan.", expression);
    return statements;
  }
  const { ast } = context.input.program.source;
  if (operation?.kind === "nullish-assignment" || ast.is.IsPrefixUnaryExpression(expression) || ast.is.IsPostfixUnaryExpression(expression)) {
    const planned = planExpression(expression, context, "discarded");
    if (planned === undefined) failRustPlannerInvariant("An admitted update requires its native discarded-value plan.", expression);
    return [{ kind: "expr", expr: planned }];
  }
  const discarded = planRustDiscardedValue(expression, context);
  if (discarded === undefined) failRustPlannerInvariant("An admitted expression requires its native discard plan.", expression);
  return discarded.discard === "unit" ? [{ kind: "expr", expr: discarded.expression }]
    : [{ kind: "let", name: "_", mutable: false, init: discarded.expression }];
}
