import type { Node } from "@tsonic/tsts";
import { forEachSourceImmediateEvaluationChild, Node_Expression } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustBorrowPureOperation } from "../../../analysis/program/borrowed-element-purity.js";
import { rustJsErrorTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustBorrowedStringView } from "../../target-ast/expressions.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustValueBlock } from "../../target-ast/value-block.js";

export function rustErrorFieldHasGuardedBorrow(node: Node, context: RustPlanContext): boolean {
  node = errorReadNode(node, context);
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  return operation?.kind === "builtin-error-property" &&
    (operation.property === "stack" || !rustTargetTypeRefEquals(operation.receiverCarrier, rustJsErrorTargetType()));
}

function errorReadNode(node: Node, context: RustPlanContext): Node {
  const { ast } = context.input.program.source;
  while (ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
    ast.is.IsTypeAssertion(node) || ast.is.IsSatisfiesExpression(node) || ast.is.IsNonNullExpression(node)) {
    const expression = Node_Expression(ast, node);
    if (expression === undefined) return node;
    node = expression;
  }
  return node;
}

export function rustErrorFieldBorrowNeedsSnapshot(
  node: Node,
  laterExpressions: readonly Node[],
  context: RustPlanContext,
): boolean {
  if (!rustErrorFieldHasGuardedBorrow(node, context)) return false;
  const owner = Node_Expression(context.input.program.source.ast, errorReadNode(node, context));
  if (owner === undefined) return false;
  return laterExpressions.some(expression => {
    const pureInvocations = new Set<Node>();
    const pending = [expression];
    while (pending.length !== 0) {
      const selected = pending.pop()!;
      if (rustBorrowPureOperation(selected, context.input.program.facts) !== undefined) pureInvocations.add(selected);
      forEachSourceImmediateEvaluationChild(context.input.program.source.ast, selected, child => pending.push(child));
    }
    const result = context.input.program.errorStorageDemands.invalidationFor(owner, expression, pureInvocations);
    if (result.kind === "unresolved") context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, expression),
      "rust.backend.error-borrow-effect", result.reason));
    return result.kind === "invalidated" || result.kind === "unproven";
  });
}

export function rustErrorFieldSharedView(node: Node, expression: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const operation = context.input.program.facts.getFact(errorReadNode(node, context), rustTargetOperationFactKey);
  return operation?.kind === "builtin-error-property" && operation.property !== "stack" &&
    !rustTargetTypeRefEquals(operation.receiverCarrier, rustJsErrorTargetType()) && expression.kind === "owned-string-from-borrowed-str"
    ? { kind: "reference", expr: { kind: "dereference", pointer: expression.expression } } : undefined;
}

export function rustErrorFieldOptionalView(node: Node, expression: RustExpr, context: RustPlanContext): RustExpr {
  const operation = context.input.program.facts.getFact(errorReadNode(node, context), rustTargetOperationFactKey);
  return operation?.kind === "builtin-error-property" && operation.property === "stack" &&
    expression.kind === "method-call" && expression.method === "map" && expression.args.length === 1 &&
    expression.args[0]?.kind === "path" && expression.args[0].path === "String::from" ? expression.receiver : expression;
}

export function rustErrorFieldComparisonView(
  node: Node | undefined,
  expression: RustExpr,
  laterExpression: Node | undefined,
  context: RustPlanContext,
): RustExpr {
  if (node !== undefined && laterExpression !== undefined &&
    rustErrorFieldBorrowNeedsSnapshot(node, [laterExpression], context)) {
    const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
    const name = allocateRustSyntheticName(names, "error_snapshot");
    return rustValueBlock([{ name, value: expression }], { kind: "path", path: name });
  }
  return rustBorrowedStringView(expression);
}
