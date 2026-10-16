import type { RustJsPromiseLowering } from "../../../../target-model/records/callables-and-resources.js";
import type { RustBlock, RustExpr } from "../../../target-ast/syntax/nodes.js";

export function wrapRustJsPromiseBody(
  body: RustBlock,
  fallible: boolean,
  lowering: RustJsPromiseLowering,
): RustBlock {
  const closure: RustExpr = { kind: "closure-block", params: [], move: true,
    async: lowering.kind === "factory", body };
  if (lowering.kind === "settled") {
    const tail = body.statements.length === 1 ? body.statements[0] : undefined;
    const completion: RustExpr = (body.innerAttrs?.length ?? 0) === 0 &&
      tail?.kind === "tail" && rustAtomicPromiseCompletion(tail.expr)
      ? tail.expr
      : (body.innerAttrs?.length ?? 0) === 0 && body.statements.length === 0
        ? { kind: "tuple-literal", elements: [] }
        : { kind: "invoke", callee: closure, args: [] };
    return wrapRustJsPromiseCompletion(completion, fallible);
  }
  return {
    statements: [{
      kind: "tail",
      expr: {
        kind: "call",
        path: fallible ? "js_abi::JsPromise::from_fallible_factory" : "js_abi::JsPromise::from_infallible_factory",
        args: [closure],
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

function rustAtomicPromiseCompletion(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "char-literal":
    case "string-literal":
    case "str-literal":
    case "none":
    case "path": return true;
    case "field": return rustAtomicPromiseCompletion(expression.receiver);
    case "tuple-literal": return expression.elements.every(rustAtomicPromiseCompletion);
    default: return false;
  }
}
