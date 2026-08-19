import type { AstReader, Node } from "@tsonic/tsts";

export function isRustStructuralObjectFieldDeclaration(
  declaration: Node,
  ast: AstReader,
): boolean {
  const kind = ast.kindName(declaration);
  return kind === "KindPropertySignature" ||
    kind === "KindPropertyDeclaration" ||
    kind === "KindPropertyAssignment" ||
    kind === "KindShorthandPropertyAssignment" ||
    kind === "KindMethodSignature" ||
    kind === "KindMethodDeclaration" ||
    kind === "KindGetAccessor" ||
    kind === "KindSetAccessor";
}
