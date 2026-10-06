import type { RustExpr } from "../../target-ast/nodes.js";

export interface RustFrameOwner {
  readonly expression: RustExpr;
  readonly borrowed: boolean;
}

export function rustFrameOwnerReference(owner: RustFrameOwner): RustExpr {
  return owner.borrowed ? owner.expression : { kind: "reference", expr: owner.expression };
}
