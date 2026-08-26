import type { AstReader, Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";

export class RustOwnershipSourceIdentityError extends Error {
  constructor(readonly node: Node) {
    super("Rust ownership analysis requires an exact authored source occurrence identity.");
  }
}

export function requireRustOwnershipSourceIdentity(
  ast: AstReader,
  node: Node,
): string {
  const identity = sourceNodeIdentity(ast, node);
  if (identity === undefined) {
    throw new RustOwnershipSourceIdentityError(node);
  }
  return identity;
}
