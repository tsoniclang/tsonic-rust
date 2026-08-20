import type { AstReader, Node } from "@tsonic/tsts";
import type { RustVisibility } from "../../rust-ast/nodes.js";
import { rustProjectMemberIsPrivate } from "../../../analysis/project-types/member-privacy.js";

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
  if (rustProjectMemberIsPrivate(ast, declaration)) {
    return "private";
  }
  return rustProjectImplementationVisibility(publiclyReachable);
}
