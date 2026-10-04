import { emptyRustGenerics, type RustGenerics, type RustItem, type RustType } from "../../target-ast/nodes.js";

export function planRustErrorObjectFormatting(type: RustType, generics: RustGenerics): readonly RustItem[] {
  return [{ kind: "impl", generics, target: type, trait: { kind: "named", path: "core::fmt::Display" },
    members: [{ kind: "function", name: "fmt", visibility: "private", generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false }, params: [{ name: "formatter", type: {
        kind: "reference", mutable: true, referent: { kind: "named", path: "core::fmt::Formatter",
          genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }] },
      } }], returnType: { kind: "named", path: "core::fmt::Result" }, body: { statements: [{ kind: "tail", expr: {
        kind: "format-write", writer: { kind: "path", path: "formatter" }, format: "{}: {}",
        args: ["name", "message"].map(name => ({ kind: "call", path: `tsonic_rust_runtime::ErrorObject::error_${name}`,
          args: [{ kind: "path", path: "self" }] })),
      } }] } }],
  }, { kind: "impl", generics, target: type, trait: { kind: "named", path: "tsonic_rust_runtime::ToSourceString" },
    members: [{ kind: "function", name: "to_source_string", visibility: "private", generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false }, params: [], returnType: { kind: "string" },
      body: { statements: [{ kind: "tail", expr: { kind: "method-call", receiver: { kind: "path", path: "self" },
        method: "to_string", args: [] } }] },
    }],
  }];
}
