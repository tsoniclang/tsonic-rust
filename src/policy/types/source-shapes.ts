import type { AstReader, Node } from "@tsonic/tsts";
import { sourceClassFieldIsTypeOnly } from "@tsonic/target-api/source";

export function isRustErasedNominalMember(declarations: readonly Node[], ast: AstReader): boolean {
  return declarations.length > 0 && declarations.every(declaration =>
    sourceClassFieldIsTypeOnly(ast, declaration) && ast.hasModifierKind(declaration, "private"));
}

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
