import type { RustJsPromiseLowering } from "../../../../target-model/records/callables-and-resources.js";
import type { RustBlock, RustExpr } from "../../../target-ast/syntax/nodes.js";

export function wrapRustJsPromiseBody(
  body: RustBlock,
  fallible: boolean,
  lowering: RustJsPromiseLowering,
): RustBlock {
  if (lowering.kind === "settled") {
    // A settled body is evaluated in place; only a body that leaves early (return, `?`, throw or a completion
    // region) needs its own closure boundary, and an immediately invoked closure otherwise trips
    // clippy::redundant_closure_call.
    const tail = body.statements.length === 1 ? body.statements[0] : undefined;
    const attributed = (body.innerAttrs?.length ?? 0) !== 0;
    const completion: RustExpr = rustPromiseBodyLeavesEarly(body)
      ? { kind: "invoke", callee: { kind: "closure-block", params: [], move: true, async: false, body }, args: [] }
      : !attributed && tail?.kind === "tail" && (tail.attrs?.length ?? 0) === 0 ? tail.expr
        : !attributed && body.statements.length === 0 ? { kind: "tuple-literal", elements: [] }
          : { kind: "block", body };
    return wrapRustJsPromiseCompletion(completion, fallible);
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

// Syntax that exits the enclosing callable; nested callables and items own their exits.
const earlyExitKinds = new Set(["return", "return-expression", "try", "option-try", "throw", "completion-exit", "try-scope", "resource-scope"]);
const callableBoundaryKinds = new Set(["closure", "closure-block", "async-block", "item"]);

function rustPromiseBodyLeavesEarly(body: RustBlock): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (value === null || typeof value !== "object") return false;
    const kind = (value as { readonly kind?: unknown }).kind;
    if (typeof kind === "string" && earlyExitKinds.has(kind)) return true;
    if (typeof kind === "string" && callableBoundaryKinds.has(kind)) return false;
    return Object.values(value).some(visit);
  };
  return visit(body.statements);
}
