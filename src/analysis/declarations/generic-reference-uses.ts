import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";

export function isRustReturnedValue(node: Node, declaration: Node, ast: AstReader): boolean {
  let current = node;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === declaration) return ast.body(declaration) === current;
    if (parent === undefined) return false;
    const kind = ast.kindName(parent);
    if (kind === "KindReturnStatement") return Node_Expression(ast, parent) === current;
    if (["KindParenthesizedExpression", "KindNonNullExpression", "KindAsExpression",
      "KindSatisfiesExpression", "KindTypeAssertionExpression"].includes(kind) &&
      Node_Expression(ast, parent) === current) {
      current = parent;
      continue;
    }
    if (ast.is.IsConditionalExpression(parent)) {
      const conditional = ast.as.AsConditionalExpression(parent);
      if (conditional?.WhenTrue === current || conditional?.WhenFalse === current) {
        current = parent;
        continue;
      }
    }
    return false;
  }
}

export function collectRustCallableDeclarations(ast: AstReader, sourceFiles: readonly SourceFile[]): readonly Node[] {
  const result: Node[] = [];
  const visit = (node: Node): void => {
    if (isRustIndependentCallable(ast, node) || isRustGenericTypeDeclaration(ast, node)) result.push(node);
    ast.forEachChild(node, child => {
      if (child !== undefined) visit(child);
    });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  return Object.freeze(result);
}

export function isRustGenericTypeDeclaration(ast: AstReader, node: Node): boolean {
  return ["KindClassDeclaration", "KindClassExpression", "KindInterfaceDeclaration", "KindTypeAliasDeclaration"].includes(ast.kindName(node));
}

export function isRustIndependentCallable(ast: AstReader, node: Node): boolean {
  return ["KindFunctionDeclaration", "KindFunctionExpression", "KindArrowFunction",
    "KindFunctionType", "KindCallSignature", "KindMethodSignature", "KindConstructSignature",
    "KindConstructorType", "KindMethodDeclaration", "KindConstructor", "KindGetAccessor",
    "KindSetAccessor"].includes(ast.kindName(node));
}

export function isRustDeclarationPathUse(
  node: Node,
  ast: AstReader,
  facts: RustPlanQueries,
): boolean {
  let current = node;
  let throughMember = false;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === undefined || Node_Expression(ast, parent) !== current) return false;
    const kind = ast.kindName(parent);
    if (kind === "KindParenthesizedExpression") {
      current = parent;
      continue;
    }
    const operation = facts.getFact(parent, rustTargetOperationFactKey);
    if (kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") {
      if (operation?.kind === "source-static-field" ||
        operation?.kind === "source-accessor" && operation.receiver.kind === "static") return true;
      current = parent;
      throughMember = true;
      continue;
    }
    if (operation?.kind !== "source-call" || operation.target.form === "callable" ||
      operation.target.form === "structural-method" || operation.target.form === "constructor-value" || operation.target.form === "union-method") return false;
    const selected = facts.getSelectedTargetCall(parent);
    return selected?.sourceDeclaration !== undefined &&
      (!throughMember || operation.target.form === "function" || operation.target.form === "static-method" ||
        selected.member.static === true || selected.member.kind === "constructor");
  }
}
