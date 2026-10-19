import type { RustJsPromiseLowering } from "../../../../target-model/records/callables-and-resources.js";
import type { RustBlock, RustExpr } from "../../../target-ast/syntax/nodes.js";

export function wrapRustJsPromiseBody(
  body: RustBlock,
  fallible: boolean,
  lowering: RustJsPromiseLowering,
): RustBlock {
  if (lowering.kind === "settled") {
    return wrapRustJsPromiseCompletion({
      kind: "invoke",
      callee: { kind: "closure-block", params: [], move: true, async: false, body },
      args: [],
    }, fallible);
  }
  return {
    statements: [{
      kind: "tail",
      expr: {
        kind: "call",
        path: fallible ? "js_abi::JsPromise::from_fallible_factory" : "js_abi::JsPromise::from_infallible_factory",
        args: [{ kind: "closure-block", params: [], move: true, async: true, body }],
      },
    }],
  };
}

export function wrapRustJsPromiseCompletion(completion: RustExpr, fallible: boolean): RustBlock {
  return { statements: [{ kind: "tail", expr: {
    kind: "call",
    path: fallible ? "js_abi::JsPromise::from_result" : "js_abi::JsPromise::resolved",
    args: [completion],
  } }] };
}
