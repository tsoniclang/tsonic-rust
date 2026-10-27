import type { RustJsPromiseLowering } from "../../../../target-model/records/callables/callables-and-resources.js";
import type { RustBlock, RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { isRustUnitCarrier } from "../../../../target-model/types/index.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function wrapRustJsPromiseBody(
  body: RustBlock,
  fallible: boolean,
  lowering: RustJsPromiseLowering,
  nativeCompletion: TargetTypeRef,
): RustBlock {
  if (nativeCompletion === undefined) failRustPlannerInvariant("A Promise body requires its sealed physical native completion.");
  if (lowering.kind === "settled") {
    // A settled body is evaluated in place; only a body that leaves early (return, `?`, throw or a completion
    // region) needs its own closure boundary, and an immediately invoked closure otherwise trips
    // clippy::redundant_closure_call.
    const tail = body.statements.length === 1 ? body.statements[0] : undefined;
    const attributed = (body.innerAttrs?.length ?? 0) !== 0;
    const completion: RustExpr = rustPromiseBodyLeavesEarly(body)
      ? { kind: "invoke", callee: { kind: "closure-block", params: [], move: true, async: false, body }, args: [] }
      : !attributed && tail?.kind === "tail" && (tail.attrs?.length ?? 0) === 0 ? tail.expr
        : !attributed && tail?.kind === "throw" && tail.tail === true && (tail.attrs?.length ?? 0) === 0
          ? { kind: "call", path: "Err", args: [tail.error] }
        : !attributed && body.statements.length === 0 ? { kind: "tuple-literal", elements: [] }
          : { kind: "block", body };
    return wrapRustJsPromiseCompletion(completion, fallible, nativeCompletion);
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

export function wrapRustJsPromiseCompletion(completion: RustExpr, fallible: boolean,
  nativeCompletion: TargetTypeRef): RustBlock {
  if (nativeCompletion === undefined) failRustPlannerInvariant("A Promise completion requires its sealed physical native carrier.");
  const unit = !fallible && isRustUnitCarrier(nativeCompletion);
  const promise: RustExpr = {
    kind: "call",
    path: fallible ? "js_abi::JsPromise::from_result" : "js_abi::JsPromise::resolved",
    args: [unit ? { kind: "tuple-literal", elements: [] } : completion],
  };
  return { statements: [{ kind: "tail", expr: unit
    ? { kind: "evaluate-then", effect: completion, discard: "unit", value: promise } : promise }] };
}

// Syntax that exits the enclosing callable; nested callables and items own their exits.
const earlyExitKinds = new Set(["return", "return-expression", "try", "option-try", "throw", "completion-exit", "try-scope", "resource-scope"]);
const callableBoundaryKinds = new Set(["closure", "closure-block", "async-block", "item"]);

function rustPromiseBodyLeavesEarly(body: RustBlock): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (value === null || typeof value !== "object") return false;
    const syntax = value as { readonly kind?: unknown; readonly tail?: unknown; readonly error?: unknown };
    const kind = syntax.kind;
    if (kind === "throw" && syntax.tail === true) return visit(syntax.error);
    if (typeof kind === "string" && earlyExitKinds.has(kind)) return true;
    if (typeof kind === "string" && callableBoundaryKinds.has(kind)) return false;
    return Object.values(value).some(visit);
  };
  return visit(body.statements);
}
