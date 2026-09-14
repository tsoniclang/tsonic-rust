import type { AstReader, Node, SourceFile } from "@tsonic/tsts";

export function rustSourceDeclarationTypeName(declaration: Node, ast: AstReader): string {
  const name = ast.text(ast.name(declaration));
  return ast.kindName(declaration) === "KindClassDeclaration" &&
      ast.parent(declaration) !== ast.getSourceFile(declaration)
    ? `${name}@${ast.pos(declaration)}`
    : name;
}

export function rustSourceTypeDeclarations(sourceFile: SourceFile, ast: AstReader): readonly Node[] {
  const declarations = ast.statements(sourceFile).filter((node): node is Node => node !== undefined);
  const visit = (node: Node): void => {
    if (ast.kindName(node) === "KindClassDeclaration" && ast.parent(node) !== sourceFile) {
      declarations.push(node);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(sourceFile);
  return declarations;
}
