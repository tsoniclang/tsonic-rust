import type { Node } from "@tsonic/tsts";
import { CaseBlock_Clauses, CaseOrDefaultClause_Expression, CaseOrDefaultClause_Statements,
  SwitchStatement_CaseBlock, SwitchStatement_Expression, KindCaseClause } from "@tsonic/target-api/source";
import type { RustBlock, RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustSwitchComparisonMatches } from "../../../analysis/facts/operations/switch.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planExpression } from "../expressions/index.js";
import { effectivePlannedExpressionCarrier } from "../expressions/fundamentals.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { directResourceDeclaration, rustBlockDefinitelyExits } from "./resources.js";
import { planStatementSequence } from "./core.js";
import { createRustBreakTarget, withRustControlTarget } from "./control-flow.js";
import { planRustSwitchComparison } from "./switch-comparisons.js";

export function planSwitchStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  const discriminantNode = SwitchStatement_Expression(ast, node);
  const clauseNodes = CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, node));
  if (fact?.kind !== "switch" || fact.operationId !== "tsonic.rust.control.switch.strict-equality" ||
    discriminantNode === undefined || clauseNodes === undefined || !isDenseDataArray(fact.clauses) ||
    !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(discriminantNode, context), fact.discriminantCarrier) ||
    clauseNodes.some((clause) => clause === undefined) || fact.clauses.length !== clauseNodes.length ||
    fact.clauses.some((clause, index) => clause === null || typeof clause !== "object" || clause.clause !== clauseNodes[index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.switch-selection",
      "Switch lowering requires one exact finalized discriminant and clause selection fact.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.switch-names",
      "Switch lowering requires finalized hygienic-name state.",
    ));
    return undefined;
  }
  const discriminant = planExpression(discriminantNode, context);
  const target = createRustBreakTarget(context, "switch");
  if (discriminant === undefined || target === undefined) {
    return undefined;
  }
  const switchContext = withRustControlTarget(context, target);
  const discriminantName = allocateRustSyntheticName(context.syntheticNames, "switch_value");
  const sections: { readonly condition?: RustExpr; readonly body: RustBlock }[] = [];
  for (let index = 0; index < clauseNodes.length; index += 1) {
    const clause = clauseNodes[index]!;
    const selected = fact.clauses[index]!;
    const sourceExpression = CaseOrDefaultClause_Expression(ast, clause);
    const statements = CaseOrDefaultClause_Statements(ast, clause);
    if (statements === undefined || statements.some((statement) => statement === undefined) ||
      (ast.kindName(clause) === KindCaseClause &&
        (sourceExpression === undefined || selected.expression !== sourceExpression ||
          selected.carrier === undefined ||
          selected.comparison === undefined ||
          !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(sourceExpression, context), selected.carrier) ||
          !rustSwitchComparisonMatches(fact.discriminantCarrier, selected.carrier, selected.comparison))) ||
      ast.kindName(clause) !== KindCaseClause &&
        (selected.expression !== undefined || selected.carrier !== undefined || selected.comparison !== undefined)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, clause),
        "rust.backend.switch-clause",
        "Switch clause conflicts with its finalized source selection fact.",
      ));
      return undefined;
    }
    if (statements.some((statement) =>
      statement !== undefined && directResourceDeclaration(statement, context) !== undefined)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, clause),
        "rust.backend.switch-resource-scope",
        "A switch-clause resource declaration requires an explicit block so its lexical disposal boundary is exact.",
      ));
      return undefined;
    }
    const expression = sourceExpression === undefined
      ? undefined
      : planExpression(sourceExpression, context);
    if (sourceExpression !== undefined && expression === undefined) {
      return undefined;
    }
    const body = planStatementSequence(
      statements,
      clause,
      switchContext,
    );
    if (body === undefined) {
      return undefined;
    }
    const condition = expression === undefined || selected.comparison === undefined ? undefined
      : planRustSwitchComparison({ kind: "path", path: discriminantName }, expression, selected.comparison, clause, context);
    if (expression !== undefined && condition === undefined) return undefined;
    sections.push({
      ...(condition === undefined ? {} : { condition }),
      body,
    });
  }

  const fallthroughBody = (start: number): RustBlock => {
    const statements: RustStmt[] = [];
    for (let index = start; index < sections.length; index += 1) {
      const section = sections[index]!;
      statements.push(...section.body.statements);
      if (rustBlockDefinitelyExits(section.body)) {
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
