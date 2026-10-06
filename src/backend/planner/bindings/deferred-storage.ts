import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export function initializeRustDeferredStorage(owner: RustExpr, payload: RustExpr, message: string): RustExpr {
  return { kind: "macro-invocation", path: "assert", delimiter: "parentheses", args: [{
    kind: "method-call", receiver: { kind: "method-call", receiver: owner, method: "set", args: [payload] },
    method: "is_ok", args: [],
  }, { kind: "str-literal", value: message }] };
}

export function initializeOrWriteRustDeferredStorage(
  owner: RustExpr, value: RustExpr, context: RustPlanContext,
  create: (value: RustExpr) => RustExpr,
  write: (owner: RustExpr, value: RustExpr) => RustExpr,
  message: string,
  mutable: boolean,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const valueName = allocateRustSyntheticName(context.syntheticNames, "field_value");
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "initialized_field");
  const selected: RustExpr = { kind: "path", path: valueName };
  return { kind: "block", body: { statements: [
    { kind: "let", name: valueName, mutable: false, init: value },
    { kind: "expr", expr: { kind: "match", expression: { kind: "method-call", receiver: owner,
      method: mutable ? "get_mut" : "get", args: [] }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: ownerName }] },
        expression: write({ kind: "path", path: ownerName }, selected) },
      { pattern: { kind: "path", path: "None" }, expression: initializeRustDeferredStorage(owner, create(selected), message) },
    ] } },
  ] } };
}
