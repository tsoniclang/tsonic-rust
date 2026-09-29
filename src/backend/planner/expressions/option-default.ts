import type { RustExpr } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustExpressionExitsCallable } from "../../target-ast/inspection/callable-exits.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { planRustOptionBranch } from "./option-branch.js";

export function rustOptionDefaultValue(
  option: RustExpr,
  fallback: RustExpr,
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr {
  if (rustExpressionExitsCallable(fallback)) {
    const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile, []);
    const presentName = allocateRustSyntheticName(names, "present_value");
    return planRustOptionBranch(option, carrier, presentName, { kind: "path", path: presentName }, fallback, context);
  }
  const value = rustOptionalStorageValue(carrier);
  if (value !== undefined) {
    const valueType = rustTypeFromCarrierInContext(value, context);
    const storageType = rustTypeFromCarrierInContext(carrier, context);
    if (valueType === undefined || storageType === undefined) throw new Error("A generic default lost its exact native storage contract.");
    context.usedAliases?.add("rt");
    return { kind: "call", path: "rt::optional_storage_coalesce", genericArguments: [
      { kind: "type", type: valueType }, { kind: "type", type: storageType }, { kind: "type", type: { kind: "infer" } },
    ], args: [option, { kind: "path", path: "core::convert::identity" }, { kind: "closure", params: [], body: fallback }] };
  }
  const eager = rustDefaultMayEvaluateEagerly(fallback);
  return {
    kind: "method-call",
    receiver: option,
    method: eager ? "unwrap_or" : "unwrap_or_else",
    args: eager
      ? [fallback]
      : [{ kind: "closure", params: [], body: fallback }],
  };
}

function rustDefaultMayEvaluateEagerly(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
      return true;
    case "unary":
      return rustDefaultMayEvaluateEagerly(expression.operand);
    case "numeric-cast":
      return rustDefaultMayEvaluateEagerly(expression.expression);
    default:
      return false;
  }
}
