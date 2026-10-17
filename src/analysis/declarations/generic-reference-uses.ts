import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

export function isRustBorrowedValueRead(node: Node, ast: AstReader, records: RustProgramRecords): boolean {
  let current = node;
  for (;;) {
    const passing = records.argumentPassing.get(current);
    if (passing !== undefined && passing.mode !== "by-value") return true;
    const parent = ast.parent(current);
    if (parent === undefined || Node_Expression(ast, parent) !== current) return false;
    if (["KindParenthesizedExpression", "KindNonNullExpression", "KindAsExpression",
      "KindSatisfiesExpression", "KindTypeAssertionExpression"].includes(ast.kindName(parent))) {
      current = parent;
      continue;
    }
    return ast.is.IsPropertyAccessExpression(parent) || ast.is.IsElementAccessExpression(parent) ||
      ast.is.IsCallExpression(parent);
  }
}

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

export function collectRustCallableDeclarations(ast: AstReader, nativeNodes: readonly Node[]): readonly Node[] {
  return Object.freeze(nativeNodes.filter(node => isRustIndependentCallable(ast, node) || isRustGenericTypeDeclaration(ast, node)));
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
  records: RustProgramRecords,
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
    const operation = records.targetOperation.get(parent);
    if (kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") {
      if (operation?.kind === "source-static-field" ||
        operation?.kind === "source-accessor" && operation.receiver.kind === "static") return true;
      current = parent;
      throughMember = true;
      continue;
    }
    if (operation?.kind !== "source-call" || operation.target.form === "callable" ||
      operation.target.form === "structural-method" || operation.target.form === "constructor-value" || operation.target.form === "union-method") return false;
    const selected = records.selectedCall.get(parent);
    return selected?.sourceDeclaration !== undefined &&
      (!throughMember || operation.target.form === "function" || operation.target.form === "static-method" ||
        selected.member.static === true || selected.member.kind === "constructor");
  }
}
