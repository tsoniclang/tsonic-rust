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
import { diagnosticInput } from "../program/plan-context.js";
import { directResourceDeclaration, planLoopExitStatement, planResourceDeclarationScope } from "./resources.js";
import { isErasedRustSafetyExpressionStatement, isRustExplicitUnsafeBlockMarker, withExplicitUnsafeContext } from "../safety/explicit-safety.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planDoStatement, planForStatement, planIfStatement, planLabeledStatement, planSwitchStatement, planWhileStatement } from "./control-flow.js";
import { planExpression } from "../expressions/index.js";
import { planExpressionStatement } from "./expression-statements.js";
import { planVariableStatement } from "./variable-declarations.js";
import { planForInStatement, planForOfStatement } from "./iteration.js";
import { planRustReturnExit } from "./completion-exits.js";
import { planThrowStatement, planTryStatement } from "./errors.js";
import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";

export type RustAssignmentOperationFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "operator-token" | "operator-call" }
>;

export function planStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const diagnosticCount = context.diagnostics.length;
  const planned = planStatementInner(node, context);
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.statement-finalization",
      "Statement planning returned no Rust AST and no specific diagnostic.",
    ));
  }
  return planned;
}

function planStatementInner(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindVariableStatement: {
      return planVariableStatement(node, context);
    }
    case KindReturnStatement: {
      const expression = Node_Expression(context.input.program.source.ast, node);
      const planned = expression === undefined
        ? context.functionUndefinedReturn ? { kind: "path" as const, path: "None" } : undefined
        : planExpression(expression, context);
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
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.statement",
        "The Rust target does not support this statement.",
      ));
      return undefined;
    }
  }
}

export function planBlockLike(node: Node, context: RustPlanContext): RustBlock | undefined {
  const { ast } = context.input.program.source;
  const children = ast.kindName(node) === KindBlock ? ast.statements(node) : [node];
  return planStatementSequence(children, node, context);
}

export function planStatementSequence(
  children: readonly (Node | undefined)[],
  diagnosticNode: Node,
  context: RustPlanContext,
): RustBlock | undefined {
  const statements: RustStmt[] = [];
  let failed = false;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, diagnosticNode),
        "rust.backend.block-statement",
        "Source block contains an undefined statement slot.",
      ));
      failed = true;
      continue;
    }
    if (isRustExplicitUnsafeBlockMarker(child, context.input)) {
      const body = planStatementSequence(
        children.slice(index + 1),
        diagnosticNode,
        withExplicitUnsafeContext(context),
      );
      if (body === undefined) {
        return undefined;
      }
      statements.push({ kind: "unsafe-scope", body });
      return { statements };
    }
    const resourceDeclaration = directResourceDeclaration(child, context);
    if (resourceDeclaration !== undefined) {
      const planned = planResourceDeclarationScope(
        child,
        resourceDeclaration,
        children.slice(index + 1),
        diagnosticNode,
        context,
      );
      if (planned === undefined) {
        failed = true;
      } else {
        statements.push(...planned);
      }
      return failed ? undefined : { statements };
    }
    const planned = planStatement(child, context);
    if (planned === undefined) {
      failed = true;
      continue;
    }
    statements.push(...planned);
  }
  return failed ? undefined : { statements };
}
