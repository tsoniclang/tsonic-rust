import type { RustSelfParam } from "../../../target-ast/syntax/nodes.js";

export type RustSelfMode = "ref" | "mut-ref" | "rc";

export function rustSelfParameter(mode: RustSelfMode): RustSelfParam {
  return mode === "rc"
    ? { kind: "rc" }
    : { kind: "reference", mutable: mode === "mut-ref" };
}
