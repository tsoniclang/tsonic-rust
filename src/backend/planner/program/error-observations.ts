import { emptyRustGenerics, type RustExpr, type RustItem, type RustPattern, type RustType } from "../../target-ast/nodes.js";

const sourceError: RustType = { kind: "named", path: "tsonic_rust_runtime::JsError" };
const errorKind: RustType = { kind: "named", path: "tsonic_rust_runtime::JsErrorKind" };
const path = (name: string): RustExpr => ({ kind: "path", path: name });
const call = (name: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path: name, args });
const method = (receiver: RustExpr, name: string, ...args: readonly RustExpr[]): RustExpr =>
  ({ kind: "method-call", receiver, method: name, args });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const variant = (name: string, ...elements: readonly RustPattern[]): RustPattern =>
  ({ kind: "tuple-variant", path: name, elements });

export function planRustErrorObservations(externalVariants: readonly string[], projectVariants: readonly string[]): RustItem {
  const optionalSource: RustType = { kind: "named", path: "Option", genericArguments: [{ kind: "type",
    type: { kind: "reference", mutable: false, referent: sourceError } }] };
  const source = method(path("self"), "source_error");
  return {
    kind: "impl", generics: emptyRustGenerics, target: { kind: "named", path: "TsonicError" },
    functions: [{
      name: "source_error", visibility: "public", generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false }, params: [], returnType: optionalSource,
      body: { statements: [{ kind: "tail", expr: { kind: "match", expression: path("self"), arms: [
        { pattern: variant("Self::Runtime", binding("error")),
          expression: call("Some", method(path("error"), "source_error")) },
        { pattern: variant("Self::Suppressed", { kind: "wildcard" }, { kind: "wildcard" }, binding("source")),
          expression: call("Some", path("source")) },
        ...externalVariants.map(name => ({ pattern: variant(`Self::${name}`, binding("error")),
          expression: method(path("error"), "source_error") })),
        ...projectVariants.map(name => ({ pattern: variant(`Self::${name}`, { kind: "wildcard" }),
          expression: { kind: "none" as const } })),
      ] } }] },
    }, {
      name: "is_error", visibility: "public", generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false }, params: [], returnType: { kind: "primitive", name: "bool" },
      body: { statements: [{ kind: "tail", expr: method(source, "is_some") }] },
    }, {
      name: "is_error_kind", visibility: "public", generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false }, params: [{ name: "kind", type: errorKind }],
      returnType: { kind: "primitive", name: "bool" },
      body: { statements: [{ kind: "tail", expr: method(source, "is_some_and", {
        kind: "closure", params: [{ name: "error", byRefCopy: false }],
        body: { kind: "binary", left: method(path("error"), "kind"), operator: "==", right: path("kind") },
      }) }] },
    }, {
      name: "error_value", visibility: "public", generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false }, params: [], returnType: sourceError,
      body: { statements: [{ kind: "tail", expr: { kind: "match", expression: source, arms: [
        { pattern: variant("Some", binding("error")), expression: method(path("error"), "clone") },
        { pattern: { kind: "path", path: "None" }, expression: { kind: "unreachable",
          message: "checked flow selected a non-Error thrown value" } },
      ] } }] },
    }],
  };
}

export function planRustSuppressedErrorConstructor(): RustItem {
  const error: RustType = { kind: "named", path: "TsonicError" };
  return {
    kind: "impl", generics: emptyRustGenerics, target: error,
    functions: [{
      name: "suppressed", visibility: "public", generics: emptyRustGenerics,
      params: [{ name: "error", type: error }, { name: "suppressed", type: error }], returnType: error,
      body: { statements: [{ kind: "tail", expr: call("Self::Suppressed",
        call("Box::new", path("error")), call("Box::new", path("suppressed")),
        call("tsonic_rust_runtime::JsError::new", path("tsonic_rust_runtime::JsErrorKind::SuppressedError"),
          { kind: "str-literal", value: "An error was suppressed during disposal." }),
      ) }] },
    }],
  };
}
