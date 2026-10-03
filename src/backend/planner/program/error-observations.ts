import { emptyRustGenerics, type RustExpr, type RustImplFunction, type RustItem, type RustPattern, type RustType } from "../../target-ast/nodes.js";
import type { RustErrorTransportPlan } from "./error-transport.js";

const jsError: RustType = { kind: "named", path: "tsonic_rust_runtime::JsError" };
const errorKind: RustType = { kind: "named", path: "tsonic_rust_runtime::JsErrorKind" };
const sourceError: RustType = { kind: "named", path: "SourceError" };
const path = (name: string): RustExpr => ({ kind: "path", path: name });
const call = (name: string, ...args: readonly RustExpr[]): RustExpr => ({ kind: "call", path: name, args });
const method = (receiver: RustExpr, name: string, ...args: readonly RustExpr[]): RustExpr =>
  ({ kind: "method-call", receiver, method: name, args });
const binding = (name: string): RustPattern => ({ kind: "binding", name });
const variant = (name: string, ...elements: readonly RustPattern[]): RustPattern =>
  ({ kind: "tuple-variant", path: name, elements });
const option = (type: RustType): RustType => ({ kind: "named", path: "Option", genericArguments: [{ kind: "type", type }] });

export function planRustErrorObservations(plan: RustErrorTransportPlan): RustItem {
  const borrowedError: RustType = { kind: "reference", mutable: false, referent: {
    kind: "trait-object", principal: { trait: { kind: "named", path: "tsonic_rust_runtime::ErrorObject" } }, autoTraits: [],
  } };
  const source = method(path("self"), "source_error");
  return {
    kind: "impl", generics: emptyRustGenerics, target: { kind: "named", path: "TsonicError" },
    members: [
      observation("source_error", option(borrowedError), { kind: "match", expression: path("self"), arms: [
        { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: call("Some", method(path("error"), "source_error")) },
        { pattern: variant("ErrorTransport::Suppressed", { kind: "wildcard" }, { kind: "wildcard" }, binding("source")), expression: call("Some", path("source")) },
        ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, item.source === "thrown" ? { kind: "wildcard" as const } : binding("error")),
          expression: item.source === "external" ? method(path("error"), "source_error")
            : item.source === "error" ? call("Some", path("error")) : { kind: "none" as const } })),
      ] }),
      observation("is_error", { kind: "primitive", name: "bool" }, method(source, "is_some")),
      observation("is_error_kind", { kind: "primitive", name: "bool" }, method(source, "is_some_and", {
        kind: "closure", params: [{ name: "error", byRefCopy: false }],
        body: { kind: "binary", left: method(path("error"), "error_kind"), operator: "==", right: path("kind") },
      }), [{ name: "kind", type: errorKind }]),
      observation("source_error_value", option(sourceError), { kind: "match", expression: path("self"), arms: [
        { pattern: variant("ErrorTransport::Runtime", binding("error")),
          expression: call("Some", call("SourceError::from", method(path("error"), "clone"))) },
        ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`,
            item.source === "thrown" ? { kind: "wildcard" as const } : binding("error")),
          expression: item.source === "thrown" ? { kind: "none" as const }
            : item.source === "error" ? call("Some", call("SourceError::from", method(path("error"), "clone")))
            : method(method(path("error"), "source_error_value"), "map", path("SourceError::from")) })),
        { pattern: variant("ErrorTransport::Suppressed", binding("error"), binding("suppressed"), binding("source")),
          expression: call("Some", { kind: "struct-literal", path: "SourceError", fields: [{ name: "value",
            value: call("ErrorTransport::Suppressed", method(path("error"), "clone"),
              method(path("suppressed"), "clone"), method(path("source"), "clone")) }] }) },
      ] }),
      observation("native_error_value", option(jsError), { kind: "match", expression: path("self"), arms: [
        { pattern: variant("ErrorTransport::Runtime", binding("error")), expression: call("Some", method(method(path("error"), "source_error"), "clone")) },
        { pattern: variant("ErrorTransport::Suppressed", { kind: "wildcard" }, { kind: "wildcard" }, binding("source")), expression: call("Some", method(path("source"), "clone")) },
        ...plan.variants.map(item => ({ pattern: variant(`ErrorTransport::${item.name}`, item.source === "external" ? binding("error") : { kind: "wildcard" as const }),
          expression: item.source === "external" ? method(path("error"), "native_error_value") : { kind: "none" as const } })),
      ] }),
    ],
  };
}

export function planRustSuppressedErrorConstructor(): RustItem {
  const error: RustType = { kind: "named", path: "TsonicError" };
  return {
    kind: "impl", generics: emptyRustGenerics, target: error,
    members: [{ kind: "function",
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

function observation(
  name: string, returnType: RustType, value: RustExpr,
  params: readonly { readonly name: string; readonly type: RustType }[] = [],
): RustImplFunction {
  return { kind: "function", name, visibility: "public", generics: emptyRustGenerics,
    selfParam: { kind: "reference", mutable: false }, params, returnType,
    body: { statements: [{ kind: "tail", expr: value }] } };
}
