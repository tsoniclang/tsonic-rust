import {
  DoStatement_Statement,
  IterationStatement_Statement,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  KindNumericLiteral,
  KindStringLiteral,
  KindVariableDeclarationList,
  Node_Expression,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations, planResourceDeclarations } from "./resources.js";
import { rustBlockDefinitelyExits } from "../../target-ast/normalization/block-flow.js";
import { isValidRustIdentifier } from "../program/plan-context.js";
import {
  negateRustPlannedBooleanExpression,
  planExpression,
  planExpressionBeforeValueProjections,
  planNumericLiteralWithCarrier,
} from "../expressions/index.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planBlockLike } from "./core.js";
import { planExpressionAsStatement } from "./expression-statements.js";
import { planVariableStatement } from "./variable-declarations.js";
import { planRustDeferredCaptureStorage, planRustCaptureStorageRotation } from "../bindings/capture-storage.js";
import { createRustLoopTarget, withRustControlTarget } from "./loop-regions.js";

import { planSelectedRustProjectTypeTest } from "../expressions/binary.js";
import type { Node } from "@tsonic/tsts";
import type { RustCountedLoopRepresentation } from "../../../analysis/control-flow/counted-loop-representations.js";
import type { RustBlock, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustLoopTarget, RustPlanContext } from "../program/plan-context.js";
function planCondition(statement: Node, context: RustPlanContext) {
  const condition = context.input.program.records.statementCondition.get(statement);
  if (condition === undefined) failRustPlannerInvariant("Control flow requires its admitted native Boolean condition.", statement);
  return planExpression(condition, context);
}

function planEmbeddedBlock(node: Node | undefined, context: RustPlanContext): RustBlock | undefined {
  if (node === undefined) {
    failRustPlannerInvariant("Control-flow construct has no source body statement.", context.sourceFile);
  }
  return planBlockLike(node, context);
}

export function planIfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    return undefined;
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
  if (planned === undefined) {
    return undefined;
  }
  const thenBlock = planEmbeddedBlock(thenStatement, context);
  const elseBlock = elseStatement === undefined ? undefined : planEmbeddedBlock(elseStatement, context);
  if (thenBlock === undefined || (elseStatement !== undefined && elseBlock === undefined)) {
    return undefined;
  }
  const terminal = thenBlock.statements.length === 1 ? thenBlock.statements[0] : undefined;
  const ast = context.input.program.source.ast;
  const sourceStatements = thenStatement !== undefined && ast.is.IsBlock(thenStatement)
    ? ast.statements(thenStatement) : [thenStatement];
  const sourceReturn = sourceStatements.length === 1 ? sourceStatements[0] : undefined;
  const returnedExpression = sourceReturn !== undefined && ast.is.IsReturnStatement(sourceReturn)
    ? Node_Expression(ast, sourceReturn) : undefined;
  const returnedOption = context.input.program.records.optionProjection.get(returnedExpression);
  if (context.fallibleBoundary === undefined && context.generator === undefined &&
    elseBlock === undefined && planned.kind === "option-presence" && !planned.present &&
    terminal?.kind === "return" && terminal.expr?.kind === "associated-value" &&
    returnedOption?.kind === "none") {
    return [{ kind: "expr", expr: { kind: "option-try", expr: {
      kind: "method-call", receiver: planned.receiver, method: "as_ref", args: [],
    } } }];
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

function tryPlanSelectedProjectTypeTestIf(
  statement: Node,
  condition: Node,
  thenStatement: Node | undefined,
  elseStatement: Node | undefined,
  context: RustPlanContext,
): { readonly handled: boolean; readonly statements?: readonly RustStmt[] } {
  const narrowedReads = context.input.program.records.projectTypeTestReads.get(statement);
  if (narrowedReads === undefined) return { handled: false };
  const fact = context.input.program.records.targetOperation.get(condition);
  if (fact?.kind !== "project-type-test" || fact.lowering.kind !== "dispatch" ||
    thenStatement === undefined || context.syntheticNames === undefined) {
    failRustPlannerInvariant("Project type-test branch requires its admitted native dispatch and read plan.", statement);
  }
  const planned = planSelectedRustProjectTypeTest(condition, context);
  if (planned?.selection === undefined) {
    return { handled: true };
  }
  const dispatchName = allocateRustSyntheticName(context.syntheticNames, "selected_dispatch");
  const selectedName = allocateRustSyntheticName(context.syntheticNames, "selected_value");
  const flowReadOverrides = new Map(context.flowReadOverrides ?? []);
  for (const read of narrowedReads) {
    flowReadOverrides.set(read, {
      sourceCarrier: planned.fact.sourceCarrier,
      selectedCarrier: planned.selection.selectedCarrier,
      expression: {
        kind: "method-call",
        receiver: { kind: "path", path: selectedName },
        method: "clone",
        args: [],
      },
    });
  }
  const thenBlock = planEmbeddedBlock(thenStatement, {
    ...context,
    flowReadOverrides,
  });
  const elseBlock = elseStatement === undefined
    ? undefined
    : planEmbeddedBlock(elseStatement, context);
  if (thenBlock === undefined || (elseStatement !== undefined && elseBlock === undefined)) {
    return { handled: true };
  }
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
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(node, context);
  if (planned === undefined) {
    return undefined;
  }
  const target = createRustLoopTarget(context, node, []);
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
): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.program.source.ast, node);
  const bodyNode = DoStatement_Statement(context.input.program.source.ast, node);
  if (condition === undefined || bodyNode === undefined) {
    failRustPlannerInvariant("do-while requires concrete body and condition nodes.", node);
  }
  const plannedCondition = planCondition(node, context);
  const baseTarget = createRustLoopTarget(context, node, []);
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
): readonly RustStmt[] | undefined {
  const counted = context.input.program.countedLoops.representationFor(node);
  if (counted !== undefined) {
    return planCountedForStatement(node, counted, context);
  }
  const initializer = ForStatement_Initializer(context.input.program.source.ast, node);
  const condition = context.input.program.records.statementCondition.get(node);
  const incrementor = ForStatement_Incrementor(context.input.program.source.ast, node);
  const planLoop = (loopContext: RustPlanContext): RustBlock | undefined => {
    const conditionExpr = condition === undefined
      ? { kind: "bool-literal" as const, value: true }
      : planCondition(node, loopContext);
    const incrementStatements = incrementor === undefined
      ? []
      : planIncrementor(incrementor, loopContext);
    const rotation = planRustCaptureStorageRotation(node, loopContext);
    if (conditionExpr === undefined || incrementStatements === undefined || rotation === undefined) {
      return undefined;
    }
    const continuation = [...rotation, ...incrementStatements];
    const target = createRustLoopTarget(loopContext, node, continuation);
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
      : { statements: [...body.statements, ...continuation] };
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
  const declarationInitializer = context.input.program.source.ast.kindName(initializer) === KindVariableDeclarationList;
  const declarations = declarationInitializer ? collectVariableDeclarations(initializer, context) : [];
  const resourceDeclarations = declarations.length > 0 &&
      (context.input.program.source.ast.variableDeclarationKind(declarations[0]) === "using" ||
        context.input.program.source.ast.variableDeclarationKind(declarations[0]) === "await using")
    ? declarations : [];
  const deferred = planRustDeferredCaptureStorage(node, context);
  if (deferred === undefined) return undefined;
  if (resourceDeclarations.length > 0) {
    const scoped = planResourceDeclarations(resourceDeclarations, context, bodyContext => {
      const rotation = planRustCaptureStorageRotation(node, bodyContext);
      const loop = rotation === undefined ? undefined : planLoop(bodyContext);
      return loop === undefined || rotation === undefined ? undefined : { statements: [...rotation, ...loop.statements] };
    });
    return scoped === undefined ? undefined : [{ kind: "scope", body: { statements: [...deferred, ...scoped] } }];
  }
  const initialization = declarationInitializer ? planVariableStatement(initializer, context)
    : planExpressionAsStatement(initializer, context);
  const rotation = planRustCaptureStorageRotation(node, context);
  if (deferred === undefined || initialization === undefined || rotation === undefined) {
    return undefined;
  }
  const initStatements = [...deferred, ...initialization, ...rotation];
  const loop = planLoop(context);
  return loop === undefined ? undefined : [{ kind: "scope", body: { statements: [...initStatements, ...loop.statements] } }];
}

function planCountedForStatement(
  node: Node,
  counted: RustCountedLoopRepresentation,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const binding = context.input.program.names.nameForDeclaration(counted.counterDeclaration) ?? "";
  const start = counted.kind === "native-counter"
    ? planExpression(counted.start, context)
    : planNumericLiteralWithCarrier(counted.start, counted.rangeCarrier, context);
  const bound = counted.kind === "native-counter"
    ? planExpression(counted.bound, context)
    : planExpressionBeforeValueProjections(counted.bound, context, "value");
  const target = createRustLoopTarget(context, node, []);
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
  if (counted.kind === "native-counter") {
    return [{
      kind: "for",
      ...(target.used.value ? { label: target.label } : {}),
      binding,
      iterable: { kind: "range", start, end: bound },
      body,
    }];
  }
  const rangeBinding = allocateRustSyntheticName(
    context.syntheticNames!,
    `${binding}_range`,
  );
  return [{
    kind: "for",
    ...(target.used.value ? { label: target.label } : {}),
    binding: rangeBinding,
    iterable: { kind: "range", start, end: bound },
    body: {
      ...body,
      statements: [{
        kind: "let",
        name: binding,
        mutable: false,
        init: {
          kind: "numeric-cast",
          expression: { kind: "path", path: rangeBinding },
          target: "f64",
        },
      }, ...body.statements],
    },
  }];
}

function planIncrementor(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  return planExpressionAsStatement(node, context);
}

export function isConstLiteralInitializer(node: Node, context: RustPlanContext): boolean {
  const kind = context.input.program.source.ast.kindName(node);
  return kind === KindNumericLiteral || kind === KindStringLiteral || kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
}
