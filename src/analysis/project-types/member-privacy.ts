import type { AstReader, Node } from "@tsonic/tsts";
import { KindPrivateIdentifier } from "@tsonic/target-api/source";

export function rustProjectMemberIsPrivate(
  ast: AstReader,
  declaration: Node,
): boolean {
  const name = ast.name(declaration);
  return ast.hasModifierKind(declaration, "private") ||
    (name !== undefined && ast.kindName(name) === KindPrivateIdentifier);
}
