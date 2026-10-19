import type { Node } from "@tsonic/tsts";
import { CaseBlock_Clauses, CaseOrDefaultClause_Expression, CaseOrDefaultClause_Statements,
  SwitchStatement_CaseBlock, SwitchStatement_Expression } from "@tsonic/target-api/source";
import type { RustBlock, RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "../expressions/index.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planStatementSequence } from "./planning.js";
import { createRustBreakTarget, withRustControlTarget } from "./loop-regions.js";
import { planRustSwitchComparison } from "./switch-comparisons.js";

export function planSwitchStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const fact = context.input.program.records.targetOperation.get(node);
  const discriminantNode = SwitchStatement_Expression(ast, node);
  const clauseNodes = CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, node));
  if (fact?.kind !== "switch" || discriminantNode === undefined || clauseNodes === undefined) {
    failRustPlannerInvariant("Switch lowering requires its admitted native discriminant and clause selection.", node);
  }
  if (context.syntheticNames === undefined) {
    failRustPlannerInvariant("Switch lowering requires finalized hygienic-name state.", node);
  }
  const discriminant = planExpression(discriminantNode, context);
  const target = createRustBreakTarget(context, node, "switch");
  if (discriminant === undefined) failRustPlannerInvariant("An admitted switch requires its discriminant value plan.", discriminantNode);
  const switchContext = withRustControlTarget(context, target);
  const discriminantName = allocateRustSyntheticName(context.syntheticNames, "switch_value");
  const sections: { readonly condition?: RustExpr; readonly body: RustBlock; readonly exits: boolean }[] = [];
  for (let index = 0; index < clauseNodes.length; index += 1) {
    const clause = clauseNodes[index]!;
    const selected = fact.clauses[index]!;
    const sourceExpression = CaseOrDefaultClause_Expression(ast, clause);
    const statements = CaseOrDefaultClause_Statements(ast, clause);
    if (statements === undefined) {
      failRustPlannerInvariant("Switch clause requires its admitted dense source statement sequence.", clause);
    }
    const exits = context.input.program.records.statementExit.get(clause);
    if (exits === undefined) {
      failRustPlannerInvariant("An admitted switch clause lost its sealed source completion.", clause);
    }
    const expression = sourceExpression === undefined
      ? undefined
      : selected.borrowedLiteral !== undefined ? { kind: "str-literal" as const, value: selected.borrowedLiteral }
      : planExpression(sourceExpression, context, "value", selected.comparison?.kind === "native" &&
          !selected.comparison.rightOptional && selected.comparison.operation.rightConversion === undefined ? "shared-place" : "value");
    if (sourceExpression !== undefined && expression === undefined) {
      failRustPlannerInvariant("An admitted switch case requires its comparison value plan.", sourceExpression);
    }
    const body = planStatementSequence(
      statements,
      clause,
      switchContext,
    );
    const condition = expression === undefined || selected.comparison === undefined ? undefined
      : planRustSwitchComparison({ kind: "path", path: discriminantName }, expression, selected.comparison, clause, context);
    if (expression !== undefined && condition === undefined) failRustPlannerInvariant("An admitted switch case requires its native comparison plan.", clause);
    sections.push({
      ...(condition === undefined ? {} : { condition }),
      body,
      exits,
    });
  }

  const fallthroughBody = (start: number): RustBlock => {
    const statements: RustStmt[] = [];
    for (let index = start; index < sections.length; index += 1) {
      const section = sections[index]!;
      statements.push(...section.body.statements);
      if (section.exits) {
        break;
      }
    }
    return { statements };
  };
  const defaultIndex = sections.findIndex((section) => section.condition === undefined);
  let selection: RustBlock = defaultIndex < 0
    ? { statements: [] }
    : fallthroughBody(defaultIndex);
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index]!;
    if (section.condition === undefined) {
      continue;
    }
    selection = {
      statements: [{
        kind: "if",
        condition: section.condition,
        then: fallthroughBody(index),
        ...(selection.statements.length === 0 ? {} : { else: selection }),
      }],
    };
  }
  if (sections.every((section) => section.condition === undefined)) {
    const body = target.used.value
      ? [{ kind: "scope" as const, label: target.label, body: selection }]
      : selection.statements;
    return [
      { kind: "let", name: "_", mutable: false, init: discriminant },
      ...body,
    ];
  }
  return [
    { kind: "let", name: discriminantName, mutable: false, init: discriminant },
    {
      kind: "scope",
      ...(target.used.value ? { label: target.label } : {}),
      body: selection,
    },
  ];
}
