import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { negateRustBooleanExpression } from "../../target-ast/syntax/expressions.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { planRustValueFieldLocation } from "../objects/value-fields.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";

export function planRustScopedStringComparison(node: Node, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.nativeComparison.get(node);
  if (selected?.kind !== "scoped-string") return undefined;
  const compare = (value: RustExpr): RustExpr => {
    const view: RustExpr = { kind: "method-call", receiver: value, method: "as_str", args: [] };
    if (selected.value.length === 0) {
      const empty: RustExpr = { kind: "method-call", receiver: view, method: "is_empty", args: [] };
      return selected.operator === "==" ? empty : negateRustBooleanExpression(empty);
    }
    const compared: RustExpr = { kind: "str-literal", value: selected.value };
    return { kind: "binary", operator: selected.operator, left: selected.reversed ? compared : view, right: selected.reversed ? view : compared };
  };
  const source = selected.source;
  if (source.kind === "provider") return planProviderOperationExpression(context, source.operation, source.receiver, source.arguments,
    source.node, { resultUse: "scoped", consume: expression => {
      const value = finishProviderOperationExpression(context, source.operation, expression, source.node);
      return value === undefined ? undefined : compare(value);
    } });
  const location = planRustValueFieldLocation(source.field, context, "read");
  if (location?.withRead === undefined) failRustPlannerInvariant("An admitted scoped string comparison requires its exact native field borrow.", source.field);
  const body = location.withRead(compare);
  return body === undefined ? undefined : rustValueBlock(location.bindings, body);
}
