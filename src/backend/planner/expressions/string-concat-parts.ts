import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustStringConcatPart } from "../../target-ast/syntax/expressions.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustErrorFieldComparisonView } from "./error-field-borrows.js";

export function planRustStringConcatOperand(node: Node, value: RustExpr, context: RustPlanContext): RustStringConcatPart {
  const selected = context.input.program.records.stringComparisonView.get(node);
  return selected?.kind === "literal" ? { kind: "literal", value: selected.value }
    : { kind: "value", value, ...(selected?.kind === "source" || selected?.kind === "contextual"
      ? { borrowed: rustErrorFieldComparisonView(node, value, undefined, context) } : {}) };
}
