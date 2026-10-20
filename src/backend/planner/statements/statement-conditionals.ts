import {
  DoStatement_Statement,
  IterationStatement_Statement,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  Node_Expression,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import {
  negateRustPlannedBooleanExpression,
  planExpression,
} from "../expressions/index.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planBlockLike } from "./planning.js";
import { requireRustReadOwnership } from "../expressions/typed-locations.js";
import { createRustLoopTarget, withRustControlTarget } from "./loop-regions.js";

import { planSelectedRustProjectTypeTest } from "../expressions/binary.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustLoopTarget, RustPlanContext } from "../program/plan-context.js";
export function planCondition(statement: Node, context: RustPlanContext) {
  const condition = context.input.program.records.statementCondition.get(statement);
  if (condition === undefined) failRustPlannerInvariant("Control flow requires its admitted native Boolean condition.", statement);
  const planned = planExpression(condition, context);
  if (planned === undefined) failRustPlannerInvariant("Admitted control flow requires its native condition value plan.", condition);
  return planned;
}

export function planEmbeddedBlock(node: Node | undefined, context: RustPlanContext): RustBlock {
  if (node === undefined) {
    failRustPlannerInvariant("Control-flow construct has no source body statement.", context.sourceFile);
  }
  return planBlockLike(node, context);
}

export function planIfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    failRustPlannerInvariant("Admitted if statement requires its checked condition.", node);
  }
  const thenStatement = IfStatement_ThenStatement(context.input.program.source.ast, node);
  const elseStatement = IfStatement_ElseStatement(context.input.program.source.ast, node);
  const selected = tryPlanSelectedProjectTypeTestIf(
    node,
    condition,
    thenStatement,
    elseStatement,
    context,
  );
  if (selected.handled) {
    return selected.statements;
  }
  const planned = planCondition(node, context);
  const thenBlock = planEmbeddedBlock(thenStatement, context);
  const elseBlock = elseStatement === undefined ? undefined : planEmbeddedBlock(elseStatement, context);
  return [{
    kind: "if",
    condition: planned,
    then: thenBlock,
    ...(context.input.program.records.statementExit.get(node) === true ? { tailEligible: true as const } : {}),
    ...(elseBlock === undefined
      ? {}
      : {
          else: elseBlock,
          ...(context.input.program.source.ast.is.IsIfStatement(elseStatement) ? { elseIf: true as const } : {}),
        }),
  }];
}

function tryPlanSelectedProjectTypeTestIf(
  statement: Node,
  condition: Node,
  thenStatement: Node | undefined,
  elseStatement: Node | undefined,
  context: RustPlanContext,
): { readonly handled: false } | { readonly handled: true; readonly statements: readonly RustStmt[] } {
  const narrowedReads = context.input.program.records.projectTypeTestReads.get(statement);
  if (narrowedReads === undefined) return { handled: false };
  const fact = context.input.program.records.targetOperation.get(condition);
  if (fact?.kind !== "project-type-test" || fact.lowering.kind !== "dispatch" ||
    thenStatement === undefined || context.syntheticNames === undefined) {
    failRustPlannerInvariant("Project type-test branch requires its admitted native dispatch and read plan.", statement);
  }
  const planned = planSelectedRustProjectTypeTest(condition, context);
  if (planned?.selection === undefined) {
    failRustPlannerInvariant("An admitted project type-test branch requires its native selection plan.", statement);
  }
  const dispatchName = allocateRustSyntheticName(context.syntheticNames, "selected_dispatch");
  const selectedName = allocateRustSyntheticName(context.syntheticNames, "selected_value");
  const flowReadOverrides = new Map(context.flowReadOverrides ?? []);
  for (const read of narrowedReads) {
    const ownership = requireRustReadOwnership(read, context).value;
    const value = { kind: "path" as const, path: selectedName };
    flowReadOverrides.set(read, {
      sourceCarrier: planned.fact.sourceCarrier,
      selectedCarrier: planned.selection.selectedCarrier,
      expression: ownership.kind === "clone" ? { kind: "method-call", receiver: value, method: "clone", args: [] }
        : ownership.kind === "borrow" ? { kind: "reference", mutable: ownership.mutable, expr: value } : value,
    });
  }
  const thenBlock = planEmbeddedBlock(thenStatement, {
    ...context,
    flowReadOverrides,
  });
  const elseBlock = elseStatement === undefined
    ? undefined
    : planEmbeddedBlock(elseStatement, context);
  return {
    handled: true,
    statements: [{ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: dispatchName }] }, expression: planned.selection.expression, whenTrue: { kind: "block", body: {
        ...thenBlock,
        statements: [{
          kind: "let",
          name: selectedName,
          mutable: false,
          init: planned.selection.selectedValue({ kind: "path", path: dispatchName }),
        }, ...thenBlock.statements],
      } }, ...(elseBlock === undefined ? {} : { whenFalse: { kind: "block", body: elseBlock } }) } }],
  };
}

export function planWhileStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    failRustPlannerInvariant("Admitted while statement requires its checked condition.", node);
  }
  const planned = planCondition(node, context);
  const target = createRustLoopTarget(context, node, []);
  const body = planEmbeddedBlock(
    IterationStatement_Statement(context.input.program.source.ast, node),
    withRustControlTarget(context, target),
  );
  const form = context.input.program.records.loopForm.get(node);
  if (form === undefined) failRustPlannerInvariant("Admitted while statement requires its sealed native loop form.", node);
  return form.kind === "unconditional"
    ? [{
        kind: "loop",
        ...(target.used.value ? { label: target.label } : {}),
        body,
        ...(form.neverFallsThrough ? { neverFallsThrough: true } : {}),
      }]
    : [{
        kind: "while",
        ...(target.used.value ? { label: target.label } : {}),
        condition: planned,
        body,
      }];
}

export function planDoStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] {
  const condition = Node_Expression(context.input.program.source.ast, node);
  const bodyNode = DoStatement_Statement(context.input.program.source.ast, node);
  if (condition === undefined || bodyNode === undefined) {
    failRustPlannerInvariant("do-while requires concrete body and condition nodes.", node);
  }
  const plannedCondition = planCondition(node, context);
  const baseTarget = createRustLoopTarget(context, node, []);
  const conditionExit: RustStmt = {
    kind: "if",
    condition: negateRustPlannedBooleanExpression(condition, plannedCondition, context),
    then: { statements: [{ kind: "break" }] },
  };
  const target: RustLoopTarget = {
    ...baseTarget,
    continuePrelude: [conditionExit],
  };
  const body = planEmbeddedBlock(
    bodyNode,
    withRustControlTarget(context, target),
  );
  const bodyExits = context.input.program.records.statementExit.get(bodyNode);
  if (bodyExits === undefined) failRustPlannerInvariant("Admitted do body requires its sealed completion.", bodyNode);
  return [{
    kind: "loop",
    ...(target.used.value ? { label: target.label } : {}),
    body: bodyExits
      ? body
      : { statements: [...body.statements, conditionExit] },
  }];
}

