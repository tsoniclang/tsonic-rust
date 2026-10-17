import type { RustJsPromiseLowering } from "../../../../target-model/records/callables-and-resources.js";
import type { RustBlock, RustExpr, RustStmt } from "../../../target-ast/syntax/nodes.js";
import { rustExpressionChildren } from "../../../target-ast/inspection/source-usage.js";

export function wrapRustJsPromiseBody(
  body: RustBlock,
  fallible: boolean,
  lowering: RustJsPromiseLowering,
): RustBlock {
  if (lowering.kind === "settled") {
    const tail = body.statements.length === 1 ? body.statements[0] : undefined;
    const needsBoundary = rustPromiseBodyNeedsBoundary(body);
    const completion: RustExpr = !needsBoundary && (body.innerAttrs?.length ?? 0) === 0 &&
      tail?.kind === "tail" && (tail.attrs?.length ?? 0) === 0
      ? tail.expr
      : (body.innerAttrs?.length ?? 0) === 0 && body.statements.length === 0
        ? { kind: "tuple-literal", elements: [] }
        : needsBoundary
          ? { kind: "invoke", callee: { kind: "closure-block", params: [], move: true, async: false, body }, args: [] }
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

function rustPromiseBodyNeedsBoundary(body: RustBlock): boolean {
  const statement = (value: RustStmt): boolean => {
    switch (value.kind) {
      case "return":
      case "throw":
      case "completion-exit":
      case "try-scope":
      case "resource-scope": return true;
      case "item":
      case "break":
      case "continue": return false;
      case "let": return value.init !== undefined && expression(value.init);
      case "tail":
      case "expr": return expression(value.expr);
      case "assign": return expression(value.target) || expression(value.value);
      case "index-assign": return expression(value.receiver) || expression(value.index) || expression(value.value);
      case "if": return expression(value.condition) || rustPromiseBodyNeedsBoundary(value.then) ||
        value.else !== undefined && rustPromiseBodyNeedsBoundary(value.else);
      case "while": return expression(value.condition) || rustPromiseBodyNeedsBoundary(value.body);
      case "while-let-some": return expression(value.expression) || rustPromiseBodyNeedsBoundary(value.body);
      case "for": return expression(value.iterable) || rustPromiseBodyNeedsBoundary(value.body);
      case "loop":
      case "scope":
      case "unsafe-scope": return rustPromiseBodyNeedsBoundary(value.body);
    }
  };
  const expression = (value: RustExpr): boolean => {
    if (value.kind === "return-expression" || value.kind === "try" || value.kind === "option-try") return true;
    if (value.kind === "closure" || value.kind === "closure-block" || value.kind === "async-block") return false;
    return value.kind === "block" ? rustPromiseBodyNeedsBoundary(value.body)
      : rustExpressionChildren(value).some(expression);
  };
  return body.statements.some(statement);
}
