import type { RustExpr } from "../../target-ast/nodes.js";

export interface RustLiveFrameOwner {
  readonly kind: "live";
  readonly expression: RustExpr;
  readonly borrowed: boolean;
  readonly data: { readonly kind: "direct" } | { readonly kind: "object"; readonly name: string };
}

export type RustFrameOwner = RustLiveFrameOwner | {
  readonly kind: "construction";
  readonly counter: RustExpr;
};

export function rustFrameOwnerReference(owner: RustLiveFrameOwner): RustExpr {
  return owner.borrowed ? owner.expression : { kind: "reference", expr: owner.expression };
}

export function projectRustFrameOwnerData(
  owner: RustLiveFrameOwner,
  project: (data: RustExpr) => RustExpr,
): RustExpr;
export function projectRustFrameOwnerData(
  owner: RustLiveFrameOwner,
  project: (data: RustExpr) => RustExpr | undefined,
): RustExpr | undefined;
export function projectRustFrameOwnerData(
  owner: RustLiveFrameOwner,
  project: (data: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  if (owner.data.kind === "direct") return project(owner.expression);
  const body = project({ kind: "path", path: owner.data.name });
  return body === undefined ? undefined : { kind: "method-call", receiver: owner.expression, method: "with",
    args: [{ kind: "closure", params: [{ name: owner.data.name, byRefCopy: false }], body }] };
}
