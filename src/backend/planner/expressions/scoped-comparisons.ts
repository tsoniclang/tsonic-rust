import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustBorrowValueIsUnprojected } from "../../../analysis/program/borrowed-element-purity.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { negateRustBooleanExpression } from "../../target-ast/expressions.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import { planRustValueFieldLocation, rustSourceFieldHasValueReceiver } from "../objects/value-fields.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { expressionCarrier } from "./fundamentals.js";
import { planExpression } from "./entry.js";

export function planRustScopedStringComparison(
  left: Node, right: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  if ((fact.operator !== "==" && fact.operator !== "!=") ||
    fact.leftConversion !== undefined || fact.rightConversion !== undefined) return undefined;
  const { ast } = context.input.program.source;
  const literal = (node: Node): boolean => ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node);
  const selected = literal(right) ? { field: left, literal: right, reversed: false }
    : literal(left) ? { field: right, literal: left, reversed: true } : undefined;
  if (selected === undefined || !rustBorrowValueIsUnprojected(selected.field, context.input.program.facts) ||
    !isRustStringCarrier(expressionCarrier(selected.field, context)) ||
    !isRustStringCarrier(expressionCarrier(selected.literal, context))) return undefined;
  if (!rustSourceFieldHasValueReceiver(selected.field, context)) return undefined;
  const location = planRustValueFieldLocation(selected.field, context, "read");
  if (location?.withRead === undefined) return undefined;
  const operand = planExpression(selected.literal, context);
  if (operand?.kind !== "string-literal" && operand?.kind !== "str-literal") return undefined;
  const operator = fact.operator;
  const body = location.withRead(value => {
    const view: RustExpr = { kind: "method-call", receiver: value, method: "as_str", args: [] };
    if (operand.value.length === 0) {
      const empty: RustExpr = { kind: "method-call", receiver: view, method: "is_empty", args: [] };
      return operator === "==" ? empty : negateRustBooleanExpression(empty);
    }
    const compared: RustExpr = { kind: "str-literal", value: operand.value };
    return { kind: "binary", operator,
      left: selected.reversed ? compared : view, right: selected.reversed ? view : compared };
  });
  return body === undefined ? undefined : rustValueBlock(location.bindings, body);
}
