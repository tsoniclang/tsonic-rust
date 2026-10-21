import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planNumericLiteral(node: Node, context: RustPlanContext): RustExpr {
  const carrier = context.input.program.records.valueRead.get(node)?.contextualInput;
  if (carrier === undefined) failRustPlannerInvariant("An admitted numeric literal requires its native carrier.", node);
  return planNumericLiteralWithCarrier(node, carrier, context);
}

export function planBigIntLiteral(node: Node, context: RustPlanContext): RustExpr {
  return planNumericLiteral(node, context);
}

export function planNumericLiteralWithCarrier(node: Node, carrier: TargetTypeRef, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.literalEmission.get(node, carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted literal requires its exact source/native emission recipe.", node);
  if (selected.kind === "integer") return { kind: "int-literal", text: selected.text };
  if (selected.kind === "float") {
    const value: RustExpr = { kind: "float-literal", text: selected.text };
    const signed: RustExpr = selected.negative ? { kind: "unary", operator: "-", operand: value } : value;
    return selected.cast === undefined ? signed : { kind: "numeric-cast", target: selected.cast, expression: signed };
  }
  context.usedAliases?.add("rt");
  return { kind: "call", path: "rt::BigInt::from_signed_bytes_le", args: [{ kind: "reference", expr: {
    kind: "slice-literal", elements: selected.bytes.map(value => ({ kind: "int-literal", text: `${value}_u8` })),
  } }] };
}
