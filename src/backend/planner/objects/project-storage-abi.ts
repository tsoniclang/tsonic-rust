import type { AstReader, Node } from "@tsonic/tsts";
import { KindPrivateIdentifier } from "@tsonic/target-api/source";
import type { RustVisibility } from "../../rust-ast/nodes.js";

export function rustProjectImplementationVisibility(
  publiclyReachable: boolean,
): RustVisibility {
  return publiclyReachable ? "public" : "crate";
}

export function rustProjectMemberStorageVisibility(
  ast: AstReader,
  declaration: Node,
  publiclyReachable: boolean,
): RustVisibility {
  const name = ast.name(declaration);
  if (ast.hasModifierKind(declaration, "private") ||
    (name !== undefined && ast.kindName(name) === KindPrivateIdentifier)) {
    return "private";
  }
  return rustProjectImplementationVisibility(publiclyReachable);
}
