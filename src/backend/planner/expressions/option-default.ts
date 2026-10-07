import type { RustExpr } from "../../target-ast/nodes.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustExpressionExitsCallable } from "../../target-ast/inspection/callable-exits.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { planRustOptionBranch } from "./option-branch.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import { rustExpressionUsesTryInCurrentRegion } from "../types/fallible-shape.js";

export function rustOptionDefaultValue(
  option: RustExpr,
  fallback: RustExpr,
  carrier: TargetTypeRef,
  context: RustPlanContext,
  resultCarrier?: TargetTypeRef,
): RustExpr {
  const value = rustOptionalStorageValue(carrier);
  const retainStorage = rustTargetTypeRefEquals(resultCarrier, carrier) && !rustTargetTypeRefEquals(value, carrier);
  const present = (expression: RustExpr): RustExpr => !retainStorage ? expression
    : value === undefined ? { kind: "call", path: "Some", args: [expression] }
      : planRustOptionalStorageOperation(carrier, "present", [expression], context);
  if (rustExpressionExitsCallable(fallback) || rustExpressionUsesTryInCurrentRegion(fallback)) {
    const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, context.sourceFile, []);
    const presentName = allocateRustSyntheticName(names, "present_value");
    return planRustOptionBranch(option, carrier, presentName, present({ kind: "path", path: presentName }), fallback, context);
  }
  if (value !== undefined) {
    const valueType = rustTypeFromCarrierInContext(value, context);
    const storageType = rustTypeFromCarrierInContext(carrier, context);
    if (valueType === undefined || storageType === undefined) throw new Error("A generic default lost its exact native storage contract.");
    context.usedAliases?.add("rt");
    return { kind: "call", path: "rt::optional_storage_coalesce", genericArguments: [
      { kind: "type", type: valueType }, { kind: "type", type: storageType }, { kind: "type", type: { kind: "infer" } },
    ], args: [option, retainStorage ? { kind: "closure", params: [{ name: "value", byRefCopy: false }], body: present({ kind: "path", path: "value" }) }
      : { kind: "path", path: "core::convert::identity" }, { kind: "closure", params: [], body: fallback }] };
  }
  const eager = rustDefaultMayEvaluateEagerly(fallback);
  return {
    kind: "method-call",
    receiver: option,
    method: retainStorage ? eager ? "or" : "or_else" : eager ? "unwrap_or" : "unwrap_or_else",
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
    case "char-literal":
    case "str-literal":
    case "none":
    case "path":
    case "associated-value":
      return true;
    case "unary":
      return rustDefaultMayEvaluateEagerly(expression.operand);
    case "numeric-cast":
      return rustDefaultMayEvaluateEagerly(expression.expression);
    case "tuple-literal":
      return expression.elements.every(rustDefaultMayEvaluateEagerly);
    default:
      return false;
  }
}
