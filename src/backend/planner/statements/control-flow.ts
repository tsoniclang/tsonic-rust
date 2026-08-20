import {
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  DoStatement_Statement,
  LabeledStatement_Label,
  LabeledStatement_Statement,
  IterationStatement_Statement,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  KindCaseClause,
  KindDoStatement,
  KindForStatement,
  KindForInStatement,
  KindNumericLiteral,
  KindStringLiteral,
  KindWhileStatement,
  Node_Expression,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations, directResourceDeclaration, planResourceManagedBody, resourceFactForPlanning, rustBlockDefinitelyExits } from "./resources.js";
import { diagnosticInput, isValidRustIdentifier } from "../program/plan-context.js";
import { expressionCarrier, negateRustPlannedBooleanExpression, planExpression } from "../expressions/index.js";
import { isRustBoolCarrier, isRustIntegerCarrier } from "../../../policy/types/target-types.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { negateRustBooleanExpression } from "../../target-ast/expressions.js";
import { planBlockLike, planStatementSequence } from "./core.js";
import { planExpressionAsStatement } from "./expression-statements.js";
import { planVariableStatement } from "./variable-declarations.js";
import { planForInStatement, planForOfStatement } from "./iteration.js";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustControlTarget, RustLoopTarget, RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

function planCondition(condition: Node, context: RustPlanContext, construct: string) {
  const carrier: TargetTypeRef | undefined = expressionCarrier(condition, context);
  if (!isRustBoolCarrier(carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, condition),
      "rust.backend.condition",
      `${construct} conditions require a finalized bool carrier fact.`,
    ));
    return undefined;
  }
  return planExpression(condition, context);
}

function planEmbeddedBlock(node: Node | undefined, context: RustPlanContext): RustBlock | undefined {
  if (node === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.embedded-statement",
      "Control-flow construct has no source body statement.",
    ));
    return undefined;
  }
  return planBlockLike(node, context);
}

export function planIfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "if");
  if (planned === undefined) {
    return undefined;
  }
  const thenBlock = planEmbeddedBlock(IfStatement_ThenStatement(context.input.program.source.ast, node), context);
  const elseStatement = IfStatement_ElseStatement(context.input.program.source.ast, node);
  const elseBlock = elseStatement === undefined ? undefined : planEmbeddedBlock(elseStatement, context);
  if (thenBlock === undefined || (elseStatement !== undefined && elseBlock === undefined)) {
    return undefined;
  }
  return [{
    kind: "if",
    condition: planned,
    then: thenBlock,
    ...(elseBlock === undefined
      ? {}
      : {
          else: elseBlock,
          ...(context.input.program.source.ast.is.IsIfStatement(elseStatement) ? { elseIf: true as const } : {}),
        }),
  }];
}

export function planLabeledStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const labelNode = LabeledStatement_Label(ast, node);
  const bodyNode = LabeledStatement_Statement(ast, node);
  const sourceLabel = labelNode === undefined ? "" : ast.text(labelNode);
  if (bodyNode === undefined || sourceLabel.length === 0) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.labeled-statement-shape",
      "Labeled statements require exact label and body nodes.",
    ));
    return undefined;
  }
  switch (ast.kindName(bodyNode)) {
    case KindWhileStatement:
      return planWhileStatement(bodyNode, context, sourceLabel);
    case KindDoStatement:
      return planDoStatement(bodyNode, context, sourceLabel);
    case KindForStatement:
      return planForStatement(bodyNode, context, sourceLabel);
    case KindForInStatement:
      return planForInStatement(bodyNode, context, sourceLabel);
    case "KindForOfStatement":
      return planForOfStatement(bodyNode, context, sourceLabel);
    default: {
      const target = createRustBreakTarget(context, "label", sourceLabel);
      if (target === undefined) {
        return undefined;
      }
      const body = planEmbeddedBlock(bodyNode, withRustControlTarget(context, target));
      return body === undefined
        ? undefined
        : [{ kind: "scope", ...(target.used.value ? { label: target.label } : {}), body }];
    }
  }
}

export function planSwitchStatement(
  node: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const fact = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  const discriminantNode = SwitchStatement_Expression(ast, node);
  const clauseNodes = CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, node));
  if (fact?.kind !== "switch" || discriminantNode === undefined || clauseNodes === undefined ||
    clauseNodes.some((clause) => clause === undefined) || fact.clauses.length !== clauseNodes.length ||
    fact.clauses.some((clause, index) => clause.clause !== clauseNodes[index])) {
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
  const sections: { readonly expression?: RustExpr; readonly body: RustBlock }[] = [];
  for (let index = 0; index < clauseNodes.length; index += 1) {
    const clause = clauseNodes[index]!;
    const selected = fact.clauses[index]!;
    const sourceExpression = CaseOrDefaultClause_Expression(ast, clause);
    const statements = CaseOrDefaultClause_Statements(ast, clause);
    if (statements === undefined || statements.some((statement) => statement === undefined) ||
      (ast.kindName(clause) === KindCaseClause &&
        (sourceExpression === undefined || selected.expression !== sourceExpression ||
          selected.carrier === undefined ||
          !rustTargetTypeRefEquals(selected.carrier, fact.discriminantCarrier)))) {
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
    sections.push({
      ...(expression === undefined
        ? {}
        : { expression: switchCaseComparisonExpression(expression) }),
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
  const defaultIndex = sections.findIndex((section) => section.expression === undefined);
  let selection: RustBlock = defaultIndex < 0
    ? { statements: [] }
    : fallthroughBody(defaultIndex);
  const discriminantName = allocateRustSyntheticName(context.syntheticNames, "switch_value");
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index]!;
    if (section.expression === undefined) {
      continue;
    }
    selection = {
      statements: [{
        kind: "if",
        condition: switchGuardCondition(discriminantName, section.expression),
        then: fallthroughBody(index),
        else: selection,
      }],
    };
  }
  if (sections.every((section) => section.expression === undefined)) {
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

function switchCaseComparisonExpression(expression: RustExpr): RustExpr {
  return expression.kind === "string-literal"
    ? { kind: "str-literal", value: expression.value }
    : expression;
}

function switchGuardCondition(discriminantName: string, expression: RustExpr): RustExpr {
  const discriminant: RustExpr = { kind: "path", path: discriminantName };
  if (expression.kind === "bool-literal") {
    return expression.value ? discriminant : negateRustBooleanExpression(discriminant);
  }
  return {
    kind: "binary",
    operator: "==",
    left: discriminant,
    right: expression,
  };
}

export function planWhileStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "while");
  if (planned === undefined) {
    return undefined;
  }
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (target === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(
    IterationStatement_Statement(context.input.program.source.ast, node),
    withRustControlTarget(context, target),
  );
  if (body === undefined) {
    return undefined;
  }
  return planned.kind === "bool-literal" && planned.value
    ? [{
        kind: "loop",
        ...(target.used.value ? { label: target.label } : {}),
        body,
        ...(!target.breakUsed.value ? { neverFallsThrough: true } : {}),
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
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  const bodyNode = DoStatement_Statement(context.input.program.source.ast, node);
  if (condition === undefined || bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.do-while-shape",
      "do-while requires concrete body and condition nodes.",
    ));
    return undefined;
  }
  const plannedCondition = planCondition(condition, context, "do-while");
  const baseTarget = createRustLoopTarget(context, [], sourceLabel);
  if (plannedCondition === undefined || baseTarget === undefined) {
    return undefined;
  }
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
  if (body === undefined) {
    return undefined;
  }
  return [{
    kind: "loop",
    ...(target.used.value ? { label: target.label } : {}),
    body: rustBlockDefinitelyExits(body)
      ? body
      : { statements: [...body.statements, conditionExit] },
  }];
}

export function planForStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const counted = planCountedForStatement(node, context, sourceLabel);
  if (counted !== undefined) {
    return counted;
  }
  const initializer = ForStatement_Initializer(context.input.program.source.ast, node);
  const condition = ForStatement_Condition(context.input.program.source.ast, node);
  const incrementor = ForStatement_Incrementor(context.input.program.source.ast, node);
  const planLoop = (loopContext: RustPlanContext): RustBlock | undefined => {
    const conditionExpr = condition === undefined
      ? { kind: "bool-literal" as const, value: true }
      : planCondition(condition, loopContext, "for");
    const incrementStatements = incrementor === undefined
      ? []
      : planIncrementor(incrementor, loopContext);
    if (conditionExpr === undefined || incrementStatements === undefined) {
      return undefined;
    }
    const target = createRustLoopTarget(loopContext, incrementStatements, sourceLabel);
    if (target === undefined) {
      return undefined;
    }
    const body = planEmbeddedBlock(
      IterationStatement_Statement(loopContext.input.program.source.ast, node),
      withRustControlTarget(loopContext, target),
    );
    if (body === undefined) {
      return undefined;
    }
    const loopBody: RustBlock = rustBlockDefinitelyExits(body)
      ? body
      : { statements: [...body.statements, ...incrementStatements] };
    return conditionExpr.kind === "bool-literal" && conditionExpr.value
      ? {
          statements: [{
            kind: "loop",
            ...(target.used.value ? { label: target.label } : {}),
            body: loopBody,
            ...(!target.breakUsed.value ? { neverFallsThrough: true } : {}),
          }],
        }
      : {
          statements: [{
            kind: "while",
            ...(target.used.value ? { label: target.label } : {}),
            condition: conditionExpr,
            body: loopBody,
          }],
        };
  };

  if (initializer === undefined) {
    const loop = planLoop(context);
    return loop?.statements;
  }
  const declarations = collectVariableDeclarations(initializer, context);
  const resourceDeclaration = declarations.length === 1 &&
      (context.input.program.source.ast.variableDeclarationKind(declarations[0]) === "using" ||
        context.input.program.source.ast.variableDeclarationKind(declarations[0]) === "await using")
    ? declarations[0]
    : undefined;
  const initStatements = planVariableStatement(initializer, context);
  if (initStatements === undefined) {
    return undefined;
  }
  if (resourceDeclaration === undefined) {
    const loop = planLoop(context);
    return loop === undefined
      ? undefined
      : [{ kind: "scope", body: { statements: [...initStatements, ...loop.statements] } }];
  }
  const fact = resourceFactForPlanning(resourceDeclaration, context);
  const resourceName = context.input.program.names.nameForDeclaration(resourceDeclaration) ?? "";
  if (fact === undefined || !isValidRustIdentifier(resourceName)) {
    return undefined;
  }
  const scope = planResourceManagedBody(
    resourceDeclaration,
    resourceName,
    fact,
    context,
    planLoop,
  );
  return scope === undefined
    ? undefined
    : [{ kind: "scope", body: { statements: [...initStatements, scope] } }];
}

function planCountedForStatement(
  node: Node,
  context: RustPlanContext,
  sourceLabel?: string,
): readonly RustStmt[] | undefined {
  const counted = context.input.program.source.navigation.countedLoop(node);
  if (counted === undefined) {
    return undefined;
  }
  const counterSummary = context.input.program.source.navigation.declarationUseSummary(
    counted.counterDeclaration,
  );
  const startCarrier = expressionCarrier(counted.start, context);
  const boundCarrier = expressionCarrier(counted.bound, context);
  if (!isRustIntegerCarrier(startCarrier) || boundCarrier === undefined ||
    !rustTargetTypeRefEquals(startCarrier, boundCarrier) ||
    counterSummary.captured || counterSummary.memberWritten ||
    !countedLoopBoundIsStable(counted.bound, context)) {
    return undefined;
  }
  const binding = context.input.program.names.nameForDeclaration(counted.counterDeclaration) ?? "";
  const start = planExpression(counted.start, context);
  const bound = planExpression(counted.bound, context);
  const target = createRustLoopTarget(context, [], sourceLabel);
  if (!isValidRustIdentifier(binding) || start === undefined || bound === undefined ||
    target === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(
    counted.body,
    withRustControlTarget(context, target),
  );
  if (body === undefined) {
    return undefined;
  }
  return [{
    kind: "for",
    ...(target.used.value ? { label: target.label } : {}),
    binding,
    iterable: { kind: "range", start, end: bound },
    body,
  }];
}

function countedLoopBoundIsStable(
  bound: Node,
  context: RustPlanContext,
): boolean {
  const effects = context.input.program.source.navigation.expressionEffects(bound);
  if (effects.invokes || effects.mutates || effects.suspends || effects.mayThrow) {
    return false;
  }
  let stable = true;
  const visited = new Set<Node>();
  const visit = (node: Node | undefined): void => {
    if (node === undefined || !stable) {
      return;
    }
    const selected = context.input.program.source.navigation.sourceReferenceFor(node);
    const declaration = selected?.declaration;
    if (declaration !== undefined && !visited.has(declaration)) {
      visited.add(declaration);
      const summary = context.input.program.source.navigation.declarationUseSummary(declaration);
      if (summary.bindingWritten) {
        stable = false;
        return;
      }
    }
    context.input.program.source.ast.forEachChild(node, visit);
  };
  visit(bound);
  return stable;
}

export function createRustLoopTarget(
  context: RustPlanContext,
  continuePrelude: readonly RustStmt[],
  sourceLabel?: string,
): RustLoopTarget | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.loop-control",
      "Loop lowering requires finalized hygienic names and control-flow state.",
    ));
    return undefined;
  }
  const target: RustLoopTarget = {
    kind: "loop",
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, "loop"),
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
    ...(context.completionBoundary === undefined
      ? {}
      : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
    breakUsed: { value: false },
    continuePrelude,
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

function createRustBreakTarget(
  context: RustPlanContext,
  kind: "switch" | "label",
  sourceLabel?: string,
): RustControlTarget | undefined {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.control-target",
      "Labeled control flow requires finalized hygienic names and control-flow state.",
    ));
    return undefined;
  }
  const target: RustControlTarget = {
    kind,
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, kind),
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
    ...(context.completionBoundary === undefined
      ? {}
      : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

export function withRustControlTarget(
  context: RustPlanContext,
  target: RustControlTarget,
): RustPlanContext {
  return {
    ...context,
    controlTargets: [...(context.controlTargets ?? []), target],
  };
}

function planIncrementor(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  return planExpressionAsStatement(node, context);
}



export function isConstLiteralInitializer(node: Node, context: RustPlanContext): boolean {
  const kind = context.input.program.source.ast.kindName(node);
  return kind === KindNumericLiteral || kind === KindStringLiteral || kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
}
