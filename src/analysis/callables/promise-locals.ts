import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, sourceEnclosingCallable, sourceExpressionResultDisposition,
  VariableDeclarationList_Declarations, type TargetSourceProgram } from "@tsonic/target-api/source";

// A Promise held in a local that is read exactly once, by an await that is the first evaluation of the statement
// right after the declaration, stays within its activation and is awaited before any other source code runs. It is
// therefore observably the same as awaiting the call directly.
export function rustAwaitedPromiseLocal(ast: AstReader, navigation: TargetSourceProgram["navigation"], call: Node): boolean {
  const disposition = sourceExpressionResultDisposition(ast, call);
  const declaration = disposition.use;
  if (disposition.kind !== "stored" || !ast.is.IsVariableDeclaration(declaration) || Node_Initializer(ast, declaration) !== call) return false;
  const list = ast.parent(declaration);
  const statement = list === undefined ? undefined : ast.parent(list);
  const block = statement === undefined ? undefined : ast.parent(statement);
  if (list === undefined || statement === undefined || block === undefined || !ast.is.IsVariableStatement(statement) ||
    ast.variableDeclarationKind(declaration) !== "const" || VariableDeclarationList_Declarations(ast, list)?.length !== 1) return false;
  const statements = ast.statements(block);
  const next = statements[statements.indexOf(statement) + 1];
  const summary = navigation.declarationUseSummary(declaration);
  if (next === undefined || summary.exported || summary.bindingWritten) return false;
  const reads = navigation.declarationUses(declaration).filter(use => use.kind !== "type-only");
  if (reads.length !== 1) return false;
  const read = reads[0]!.reference;
  const awaited = sourceExpressionResultDisposition(ast, read);
  if (awaited.kind !== "awaited-in-scope" || sourceEnclosingCallable(read, ast) !== sourceEnclosingCallable(call, ast)) return false;
  for (let current: Node = awaited.use; current !== next;) {
    const parent = ast.parent(current);
    if (parent === undefined || !evaluatesFirst(ast, parent, current)) return false;
    current = parent;
  }
  return true;
}

function evaluatesFirst(ast: AstReader, parent: Node, child: Node): boolean {
  if (ast.is.IsReturnStatement(parent) || ast.is.IsExpressionStatement(parent) || ast.is.IsParenthesizedExpression(parent) ||
    ast.is.IsAwaitExpression(parent) || ast.is.IsPrefixUnaryExpression(parent)) return Node_Expression(ast, parent) === child;
  if (ast.is.IsVariableStatement(parent)) return true;
  if (ast.is.IsVariableDeclarationList(parent)) return VariableDeclarationList_Declarations(ast, parent)?.[0] === child;
  if (ast.is.IsVariableDeclaration(parent)) return Node_Initializer(ast, parent) === child;
  if (ast.is.IsBinaryExpression(parent)) {
    const operator = ast.operatorKindName(parent);
    return operator !== undefined && (!operator.endsWith("EqualsToken") || comparisons.has(operator)) && ast.as.AsBinaryExpression(parent)?.Left === child;
  }
  if (ast.is.IsIfStatement(parent)) return Node_Expression(ast, parent) === child;
  return false;
}

const comparisons: ReadonlySet<string> = new Set(["KindEqualsEqualsToken", "KindEqualsEqualsEqualsToken", "KindExclamationEqualsToken",
  "KindExclamationEqualsEqualsToken", "KindLessThanEqualsToken", "KindGreaterThanEqualsToken"]);
