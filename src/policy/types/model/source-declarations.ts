import type { AstReader, Node, SourceFile } from "@tsonic/tsts";

export function rustSourceDeclarationTypeName(declaration: Node, ast: AstReader): string {
  const kind = ast.kindName(declaration);
  const name = ast.name(declaration) === undefined && kind === "KindClassExpression"
    ? "Anonymous" : ast.text(ast.name(declaration));
  return (kind === "KindClassDeclaration" || kind === "KindClassExpression") &&
      ast.parent(declaration) !== ast.getSourceFile(declaration)
    ? `${name}@${ast.pos(declaration)}`
    : name;
}

export function rustSourceTypeDeclarations(sourceFile: SourceFile, ast: AstReader): readonly Node[] {
  const declarations = ast.statements(sourceFile).filter((node): node is Node => node !== undefined);
  const visit = (node: Node): void => {
    const kind = ast.kindName(node);
    if ((kind === "KindClassDeclaration" || kind === "KindClassExpression") && ast.parent(node) !== sourceFile) {
      declarations.push(node);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(sourceFile);
  return declarations;
}
