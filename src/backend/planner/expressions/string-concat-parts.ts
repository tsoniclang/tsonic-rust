import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustStringConcatPart } from "../../target-ast/syntax/expressions.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustErrorFieldComparisonView } from "./error-field-borrows.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";

export function planRustStringConcatOperand(node: Node, value: RustExpr, context: RustPlanContext): RustStringConcatPart {
  const selected = context.input.program.records.stringComparisonView.get(node);
  const read = context.input.program.records.readOwnership.get(node);
  const owned: RustExpr = read?.sharedReference === true && isRustStringCarrier(read.carrier)
    ? { kind: "owned-string-from-borrowed-str", expression: value } : value;
  return selected?.kind === "literal" ? { kind: "literal", value: selected.value }
    : { kind: "value", value: owned, ...(selected?.kind === "source" || selected?.kind === "contextual"
      ? { borrowed: rustErrorFieldComparisonView(node, value, undefined, context) } : {}) };
}
