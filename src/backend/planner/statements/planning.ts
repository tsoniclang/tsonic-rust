import {
  KindBlock,
  KindBreakStatement,
  KindContinueStatement,
  KindDebuggerStatement,
  KindDoStatement,
  KindEmptyStatement,
  KindExpressionStatement,
  KindForStatement,
  KindForInStatement,
  KindIfStatement,
  KindLabeledStatement,
  KindReturnStatement,
  KindSwitchStatement,
  KindVariableStatement,
  KindWhileStatement,
  Node_Expression,
} from "@tsonic/target-api/source";
import { prepareRustFrameScope } from "../bindings/frame-storage.js";
import { directResourceDeclarations, planLoopExitStatement, planResourceDeclarations } from "./resource-management.js";
import { isErasedRustSafetyExpressionStatement, isRustExplicitUnsafeBlockMarker, withExplicitUnsafeContext } from "../safety/explicit-safety.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { planDoStatement, planIfStatement, planWhileStatement } from "./statement-conditionals.js";
import { planForStatement } from "./statement-for.js";
import { planLabeledStatement } from "./statement-labels.js";
import { planSwitchStatement } from "./switch-statements.js";
import { planExpression } from "../expressions/index.js";
import { planRustReturnValueExpression } from "../expressions/value-destinations.js";
import { planExpressionStatement } from "./statement-simple.js";
import { planVariableStatement } from "../bindings/locals.js";
import { planForInStatement, planForOfStatement } from "./statement-loops.js";
import { planRustReturnExit } from "./completion-exits.js";
import { planThrowStatement, planTryStatement } from "./statement-try.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

import { planRustBorrowedElementLocal } from "../expressions/borrowed-element-reads.js";
import { planRustClassEnvironmentValue } from "../objects/class-environments.js";
import { planRustAbsentValue } from "../expressions/optional-storage.js";

import { planFunctionDeclarations } from "../declarations/callables/functions.js";
import { planRustDeferredCaptureStorage } from "../bindings/capture-storage.js";
import { planRustLexicalFunctionValues } from "../declarations/callables/lexical-values.js";

export function planStatement(node: Node, context: RustPlanContext): readonly RustStmt[] {
  const construction = context.input.program.source.ast.kindName(node) === KindBlock ? undefined
    : context.construction?.prepare(node, context);
  const inner = planStatementInner(node, construction?.context ?? context);
  const planned = inner === undefined ? undefined : construction === undefined ? inner
    : [...construction.before, ...construction.finish(inner)];
  if (planned === undefined) failRustPlannerInvariant("Admitted statement requires its finalized Rust syntax.", node);
  return planned;
}

function planStatementInner(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  if (context.input.program.records.nativeUnreachable.get(node) === true ||
    context.input.program.records.compileTimeSource.get(node) !== undefined ||
    context.input.program.records.nativeParticipation.get(node) === "erased") return [];
  if (context.input.program.records.statementAdmission.get(node) !== true)
    failRustPlannerInvariant("Statement dispatch requires its admitted native source construct.", node);
  const { ast } = context.input.program.source;
  const kind = ast.kindName(node);
  switch (kind) {
    case "KindFunctionDeclaration": {
      const participation = context.input.program.records.nativeParticipation.get(node);
      if (participation === undefined) failRustPlannerInvariant(
        "Authored function placement requires its sealed native participation.", node);
      if (participation === "erased") return [];
      const items = planFunctionDeclarations(node, context);
      return items?.map(item => ({ kind: "item", item }));
    }
    case "KindClassDeclaration": {
      const declaration = context.input.program.records.classDeclaration.get(node);
      if (declaration === undefined)
        failRustPlannerInvariant("Admitted class requires its sealed native definition.", node);
      if (declaration.environmentBindingName === undefined) return [];
      const value = planRustClassEnvironmentValue(node, context);
      return value === undefined ? undefined : [{ kind: "let", name: declaration.environmentBindingName, mutable: false, init: value }];
    }
    case "KindTypeAliasDeclaration": {
      if (context.input.program.records.typeAliasDeclaration.get(node)?.kind !== "erased")
        failRustPlannerInvariant("An admitted type alias requires its erased declaration record.", node);
      return [];
    }
    case KindVariableStatement: {
      return planVariableStatement(node, context);
    }
    case KindReturnStatement: {
      const constructionReturn = context.construction?.returnFor(node, context);
      if (constructionReturn !== undefined) return constructionReturn;
      const expression = Node_Expression(context.input.program.source.ast, node);
      const planned = expression === undefined
        ? context.functionAbsenceReturnCarrier === undefined ? undefined
          : planRustAbsentValue(context.functionAbsenceReturnCarrier, context)
        : planRustReturnValueExpression(expression, context, planExpression);
      if (expression !== undefined && planned === undefined) {
        return undefined;
      }
      return [planRustReturnExit(planned, context)];
    }
    case KindBreakStatement:
    case KindContinueStatement: {
      return planLoopExitStatement(node, kind === KindBreakStatement ? "break" : "continue", context);
    }
    case KindEmptyStatement:
    case KindDebuggerStatement: {
      return [];
    }
    case KindLabeledStatement: {
      return planLabeledStatement(node, context);
    }
    case KindSwitchStatement: {
      return planSwitchStatement(node, context);
    }
    case KindExpressionStatement: {
      if (isErasedRustSafetyExpressionStatement(node, context.input)) {
        return [];
      }
      return planExpressionStatement(node, context);
    }
    case KindIfStatement: {
      const statement = ast.as.AsIfStatement(node);
      const result = statement?.Expression === undefined ? undefined
        : context.input.program.records.nativeGuardResult.get(statement.Expression);
      if (result !== undefined) {
        const branch = result ? statement?.ThenStatement : statement?.ElseStatement;
        if (branch === undefined) return [];
        const body = planBlockLike(branch, context);
        return body === undefined ? undefined : [{ kind: "scope", body }];
      }
      return planIfStatement(node, context);
    }
    case KindWhileStatement: {
      return planWhileStatement(node, context);
    }
    case KindDoStatement: {
      return planDoStatement(node, context);
    }
    case KindForStatement: {
      return planForStatement(node, context);
    }
    case KindForInStatement: {
      return planForInStatement(node, context);
    }
    case "KindForOfStatement": {
      return planForOfStatement(node, context);
    }
    case "KindThrowStatement": {
      return planThrowStatement(node, context);
    }
    case "KindTryStatement": {
      return planTryStatement(node, context);
    }
    case KindBlock: {
      const body = planBlockLike(node, context);
      return body === undefined ? undefined : [{ kind: "scope", body }];
    }
    default: {
      failRustPlannerInvariant("Statement dispatch requires its admitted native source construct.", node);
    }
  }
}

export function planBlockLike(node: Node, context: RustPlanContext): RustBlock {
  const { ast } = context.input.program.source;
  const children = ast.kindName(node) === KindBlock ? ast.statements(node) : [node];
  const construction = ast.kindName(node) === KindBlock ? context.construction?.prepare(node, context) : undefined;
  const planned = planStatementSequence(children, node, construction?.context ?? context);
  return construction === undefined ? planned
    : { ...planned, statements: [...construction.before, ...construction.finish(planned.statements)] };
}

export function planStatementSequence(
  children: readonly (Node | undefined)[],
  diagnosticNode: Node,
  context: RustPlanContext,
  initializeScope = true,
): RustBlock {
  const frame = initializeScope ? prepareRustFrameScope(diagnosticNode, context) : { context, statements: [] };
  if (frame === undefined) failRustPlannerInvariant("An admitted statement scope requires its native frame plan.", diagnosticNode);
  context = frame.context;
  const prologue = initializeScope ? planRustDeferredCaptureStorage(diagnosticNode, context) : [];
  if (prologue === undefined) failRustPlannerInvariant("An admitted statement scope requires its capture prologue.", diagnosticNode);
  const statements: RustStmt[] = [...frame.statements, ...prologue];
  let sequenceContext = context;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      failRustPlannerInvariant("Statement sequence requires its dense checked source nodes.", diagnosticNode);
    }
    const callableValues = planRustLexicalFunctionValues(child, sequenceContext);
    if (callableValues === undefined) failRustPlannerInvariant("Admitted lexical function values require their native plans.", child);
    statements.push(...callableValues);
    if (isRustExplicitUnsafeBlockMarker(child, sequenceContext.input)) {
      const body = planStatementSequence(
        children.slice(index + 1),
        diagnosticNode,
        withExplicitUnsafeContext(sequenceContext),
        false,
      );
      statements.push({ kind: "unsafe-scope", body });
      return { statements };
    }
    const resourceDeclarations = directResourceDeclarations(child, sequenceContext);
    if (resourceDeclarations.length > 0) {
      const planned = planResourceDeclarations(
        resourceDeclarations,
        sequenceContext,
        (bodyContext) => planStatementSequence(children.slice(index + 1), diagnosticNode, bodyContext, false),
      );
      if (planned === undefined) failRustPlannerInvariant("Admitted resource declarations require their native scope plan.", child);
      statements.push(...planned);
      return { statements };
    }
    const borrowed = sequenceContext.input.program.records.borrowedElementLocal.get(child);
    const local = borrowed === undefined ? undefined : planRustBorrowedElementLocal(borrowed, sequenceContext);
    const planned = borrowed === undefined ? planStatement(child, sequenceContext) : local?.statements;
    if (planned === undefined) {
      failRustPlannerInvariant("Admitted borrowed local requires its native binding plan.", child);
    }
    if (local !== undefined) sequenceContext = local.context;
    statements.push(...planned);
    const exits = sequenceContext.input.program.records.statementExit.get(child);
    if (exits === undefined) failRustPlannerInvariant("Admitted statement requires its sealed completion.", child);
    if (!exits) {
      for (const read of sequenceContext.input.program.records.borrowedElementEnds.get(child) ?? []) {
        const name = sequenceContext.input.program.records.sourceName.get(read.declaration);
        if (name === undefined) failRustPlannerInvariant("An admitted borrowed binding requires its authored native name.", read.declaration);
        statements.push({ kind: "expr", expr: { kind: "call", path: "core::mem::drop", args: [{ kind: "path", path: name }] } });
      }
    }
  }
  return { statements };
}
