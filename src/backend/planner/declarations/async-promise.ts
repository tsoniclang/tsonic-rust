import type { RustBlock } from "../../target-ast/nodes.js";

export function wrapRustJsPromiseBody(
  body: RustBlock,
  fallible: boolean,
): RustBlock {
  return {
    statements: [{
      kind: "tail",
      expr: {
        kind: "call",
        path: fallible
          ? "js_abi::JsPromise::from_fallible_factory"
          : "js_abi::JsPromise::from_infallible_factory",
        args: [{
          kind: "closure-block",
          params: [],
          move: true,
          async: true,
          body,
        }],
      },
    }],
  };
}
