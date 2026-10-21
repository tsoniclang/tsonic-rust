import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "./entry.js";

export function planRustClosedRecordLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = context.input.program.records.closedRecord.get(node)
    ?? failRustPlannerInvariant("An admitted closed record requires its ordered native property and carrier inventory.", node);
  const elements: RustExpr[] = [];
  for (const field of fact.fields) {
    const value = planExpression(field.expression, context);
    if (value === undefined) return undefined;
    elements.push({ kind: "tuple-literal", elements: [{ kind: "str-literal", value: field.sourceName }, value] });
  }
  return { kind: "call", path: "js_abi::JsValue::object", args: [{ kind: "call", path: "js_abi::JsObject::from_pairs",
    args: [{ kind: "slice-literal", elements }] }] };
}
