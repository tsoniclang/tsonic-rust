import type { RustSelfParam } from "../../../target-ast/nodes.js";

export type RustSelfMode = "ref" | "mut-ref" | "rc";

export function rustSelfParameter(mode: RustSelfMode): RustSelfParam {
  return mode === "rc"
    ? { kind: "typed", type: { kind: "named", path: "alloc::rc::Rc",
        genericArguments: [{ kind: "type", type: { kind: "named", path: "Self" } }] } }
    : { kind: "reference", mutable: mode === "mut-ref" };
}
