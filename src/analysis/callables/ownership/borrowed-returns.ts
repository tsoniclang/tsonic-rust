import type { Node } from "@tsonic/tsts";
import type { RustExplicitUnsafeContexts } from "../../safety/explicit-regions.js";
import { isSourceCallableBodyBoundary, Node_Expression, Node_Initializer, sourceCallableValueParameters,
  sourceEnclosingCallable, sourceTransparentExpressionOperand, type TargetSourceProgram } from "@tsonic/target-api/source";
import { createRustSourceLexicalCallableQueries } from "../values/lexical-bindings.js";
import type { RustSourceCallableQueries, RustSourceReturnBorrow } from "../../../target-model/records/callables/source-callables.js";

export function createRustSourceCallableQueries(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  explicitUnsafe: RustExplicitUnsafeContexts,
  promiseCallAliasTarget: (binding: Node) => Node | undefined,
): RustSourceCallableQueries {
  const lexical = createRustSourceLexicalCallableQueries(source, nodes, explicitUnsafe);
  const returns = new WeakMap<Node, RustSourceReturnBorrow>();
  for (const declaration of nodes) {
    if (!isSourceCallableBodyBoundary(source.ast, declaration)) continue;
    const selected = selectSourceBorrowedReturn(declaration, source);
    if (selected !== undefined) returns.set(declaration, selected);
  }
  return Object.freeze({
    directLexicalBinding: lexical.bindingFor,
    borrowedReturn: (declaration: Node) => returns.get(declaration),
    promiseCallAliasTarget,
  });
}

function selectSourceBorrowedReturn(declaration: Node, source: TargetSourceProgram): RustSourceReturnBorrow | undefined {
  const { ast } = source;
  const body = ast.body(declaration);
  const semantics = source.semantics.forNode(declaration);
  if (body === undefined || ast.hasModifierKind(declaration, "async") ||
    semantics.operations.generator(declaration) !== undefined ||
    semantics.operations.callableCompletion(declaration)?.canFallThrough !== false) return undefined;
  const parameters = sourceCallableValueParameters(ast, declaration, semantics);
  if (parameters === undefined || parameters.length === 0) return undefined;
  const expressions: Node[] = [];
  const pending = [body];
  while (pending.length !== 0) {
    const node = pending.pop()!;
    if (node !== body && isSourceCallableBodyBoundary(ast, node)) continue;
    if (ast.is.IsReturnStatement(node)) {
      const expression = Node_Expression(ast, node);
      if (expression === undefined) return undefined;
      expressions.push(expression);
    } else if (node === body && !ast.is.IsBlock(body)) expressions.push(body);
    else ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  if (expressions.length === 0) return undefined;
  const parameter = returnedInput(expressions[0]!, declaration, parameters, source, true);
  if (parameter === undefined || expressions.some(expression =>
    returnedInput(expression, declaration, parameters, source, true) !== parameter)) return undefined;
  const summary = source.navigation.parameterUseSummary(parameter);
  if (summary === undefined || summary.bindingWritten || summary.memberWritten || summary.captured ||
    summary.yielded || summary.exported || summary.hasUnclassifiedValueUse) return undefined;
  return Object.freeze({ parameter, returns: Object.freeze(expressions) });
}

function returnedInput(expression: Node, declaration: Node, parameters: readonly Node[],
  source: TargetSourceProgram, allowAlias: boolean): Node | undefined {
  const { ast } = source;
  let current = expression;
  while (true) {
    const operand = sourceTransparentExpressionOperand(ast, current);
    if (operand !== undefined) current = operand;
    else if (ast.is.IsPropertyAccessExpression(current) || ast.is.IsElementAccessExpression(current)) {
      const property = ast.is.IsPropertyAccessExpression(current)
        ? source.semantics.forNode(current).operations.propertyAccess(current) : undefined;
      const member = property?.selectedReadDeclaration ?? property?.selectedDeclaration;
      if (member !== undefined && (ast.is.IsGetAccessorDeclaration(member) || ast.is.IsMethodDeclaration(member))) return undefined;
      const receiver = Node_Expression(ast, current);
      if (receiver === undefined) return undefined;
      current = receiver;
    } else break;
  }
  if (!ast.is.IsIdentifier(current)) return undefined;
  const selected = source.navigation.sourceReferenceFor(current)?.declaration;
  if (selected === undefined) return undefined;
  if (parameters.includes(selected)) return selected;
  if (!allowAlias || !ast.is.IsVariableDeclaration(selected) || sourceEnclosingCallable(selected, ast) !== declaration) return undefined;
  const initializer = Node_Initializer(ast, selected);
  const summary = source.navigation.declarationUseSummary(selected);
  return initializer === undefined || summary.bindingWritten || summary.memberWritten || summary.captured || summary.exported
    ? undefined : returnedInput(initializer, declaration, parameters, source, false);
}
