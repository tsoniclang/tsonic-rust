import type { RustFrameCallableTypes } from "../../types/frame-callables.js";
import type { RustGenerics, RustItem, RustType } from "../../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../../target-ast/nodes.js";

export function planRustFrameCallableFamilyItems(
  types: RustFrameCallableTypes, independentType: RustType, generics: RustGenerics,
): readonly RustItem[] {
  return [{ kind: "impl", generics, trait: { kind: "named", path: "rt::FrameCallableFamilyEntry",
    genericArguments: [{ kind: "type", type: types.frameType }] }, target: types.entryType, members: [
    { kind: "function", name: "from_independent", visibility: "private", generics: emptyRustGenerics,
      params: [{ name: "value", type: independentType }], returnType: { kind: "named", path: "Self" },
      body: { statements: [{ kind: "tail", expr: { kind: "call", path: "Self::Independent",
        args: [{ kind: "path", path: "value" }] } }] } },
    { kind: "function", name: "into_independent", visibility: "private", generics: emptyRustGenerics,
      selfParam: { kind: "value" }, params: [], returnType: { kind: "named", path: "Result", genericArguments: [
        { kind: "type", type: independentType }, { kind: "type", type: { kind: "named", path: "Self" } },
      ] }, body: { statements: [{ kind: "tail", expr: { kind: "match", expression: { kind: "path", path: "self" }, arms: [
        { pattern: { kind: "tuple-variant", path: "Self::Independent", elements: [{ kind: "binding", name: "value" }] },
          expression: { kind: "call", path: "Ok", args: [{ kind: "path", path: "value" }] } },
        { pattern: { kind: "binding", name: "entry" },
          expression: { kind: "call", path: "Err", args: [{ kind: "path", path: "entry" }] } },
      ] } }] } },
  ] }];
}
