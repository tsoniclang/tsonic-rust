import type { RustExpr } from "../../target-ast/nodes.js";
import type { Node } from "@tsonic/tsts";

export interface RustLiveFrameOwner {
  readonly kind: "live";
  readonly expression: RustExpr;
  readonly borrowed: boolean;
  readonly data: { readonly kind: "direct" } | { readonly kind: "object"; readonly name: string; readonly mutable: boolean };
  readonly receiver?: Node;
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
  mutable?: boolean,
): RustExpr;
export function projectRustFrameOwnerData(
  owner: RustLiveFrameOwner,
  project: (data: RustExpr) => RustExpr | undefined,
  mutable?: boolean,
): RustExpr | undefined;
export function projectRustFrameOwnerData(
  owner: RustLiveFrameOwner,
  project: (data: RustExpr) => RustExpr | undefined,
  mutable = false,
): RustExpr | undefined {
  if (owner.data.kind === "direct") return project(owner.expression);
  const body = project({ kind: "path", path: owner.data.name });
  return body === undefined || mutable && !owner.data.mutable ? undefined : {
    kind: "method-call", receiver: owner.expression, method: mutable ? "with_mut" : "with",
    args: [{ kind: "closure", params: [{ name: owner.data.name, byRefCopy: false }], body }] };
}
