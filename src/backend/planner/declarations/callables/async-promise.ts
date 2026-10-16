import type { RustJsPromiseLowering } from "../../../../target-model/records/callables-and-resources.js";
import type { RustBlock, RustExpr } from "../../../target-ast/syntax/nodes.js";

export function wrapRustJsPromiseBody(
  body: RustBlock,
  fallible: boolean,
  lowering: RustJsPromiseLowering,
): RustBlock {
  const closure: RustExpr = { kind: "closure-block", params: [], move: true,
    async: lowering.kind === "factory", body };
  return {
    statements: [{
      kind: "tail",
      expr: {
        kind: "call",
        path: lowering.kind === "settled"
          ? fallible ? "js_abi::JsPromise::from_result" : "js_abi::JsPromise::resolved"
          : fallible ? "js_abi::JsPromise::from_fallible_factory" : "js_abi::JsPromise::from_infallible_factory",
        args: [lowering.kind === "settled" ? { kind: "invoke", callee: closure, args: [] } : closure],
      },
    }],
  };
}
