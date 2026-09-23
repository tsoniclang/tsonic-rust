import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustContextualValueConversionFact } from "../../../policy/types/value-projections.js";
import { rustIntegerTruncationConversionMatches } from "../../../target-model/conversions/integer-truncation.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustIntegerTruncation(
  expression: RustExpr,
  fact: RustContextualValueConversionFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const conversion = fact.conversion;
  if (conversion.kind !== "integer-truncation" ||
    !rustIntegerTruncationConversionMatches(fact.sourceCarrier, fact.targetCarrier, conversion)) return undefined;
  const type = rustTypeFromCarrierInContext(fact.targetCarrier, context);
  const invocation = expression.kind === "try" ? expression.expr : expression;
  if (type === undefined || invocation.kind !== "call" || invocation.args.length !== 2) return undefined;
  const call: RustExpr = {
    ...invocation,
    path: conversion.signed ? "js_abi::bigint_as_int_native" : "js_abi::bigint_as_uint_native",
  };
  return {
    kind: "cast", type,
    expr: expression.kind === "try" ? { ...expression, expr: call } : call,
  };
}
