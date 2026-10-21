import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustUnionConstruction } from "./union-patterns.js";

export function planRustOptionalStorageOperation(carrier: TargetTypeRef,
  method: "present" | "absent" | "is_absent" | "into_present" | "clone_present", args: readonly RustExpr[],
  context: RustTypeRenderingContext): RustExpr {
  const storage = context.input.program.records.typeEmission.get(carrier)?.optionalStorage;
  if (storage?.kind !== "custom") failRustPlannerInvariant("An admitted optional operation requires its native storage contract.");
  return planOptionalStorageCall(carrier, storage.element, method, args, context);
}

export function planRustCheckedSourceOptional(expression: RustExpr, element: TargetTypeRef,
  context: RustTypeRenderingContext): RustExpr {
  const selection = context.input.program.records.typeEmission.get(element)?.sourceOptional;
  if (selection === undefined) failRustPlannerInvariant("An admitted optional value requires its selected native storage.");
  switch (selection.kind) {
    case "identity": return expression;
    case "unit": return { kind: "evaluate-then", effect: expression, discard: "value", value: { kind: "tuple-literal", elements: [] } };
    case "flatten": return { kind: "method-call", receiver: expression, method: "flatten", args: [] };
    case "custom-flatten": return { kind: "method-call", receiver: expression, method: "unwrap_or_else",
      args: [{ kind: "closure", params: [], body: planRustOptionalStorageOperation(element, "absent", [], context) }] };
    case "js-value": context.usedAliases?.add("js_abi"); return { kind: "method-call", receiver: expression,
      method: "unwrap_or", args: [{ kind: "path", path: "js_abi::JsValue::Null" }] };
    case "custom": return planOptionalStorageCall(selection.storage, element, "from_option", [expression], context);
  }
}

function planOptionalStorageCall(carrier: TargetTypeRef, value: TargetTypeRef, method: string,
  args: readonly RustExpr[], context: RustTypeRenderingContext): RustExpr {
  const owner = rustTypeFromCarrierInContext(carrier, context);
  const valueType = rustTypeFromCarrierInContext(value, context);
  if (owner === undefined || valueType === undefined) failRustPlannerInvariant("An admitted native optional operation requires its storage and payload types.");
  context.usedAliases?.add("rt");
  return { kind: "associated-call", owner, method, args,
    trait: { kind: "named", path: "rt::OptionalStorage", genericArguments: [{ kind: "type", type: valueType }] } };
}

export function planRustAbsentValue(carrier: TargetTypeRef, context: RustTypeRenderingContext): RustExpr {
  const storage = context.input.program.records.typeEmission.get(carrier)?.optionalStorage;
  switch (storage?.kind) {
    case "unit": return { kind: "tuple-literal", elements: [] };
    case "option": {
      if (context.input.program.records.typeEmission.get(carrier)?.anonymousOptional === true) return { kind: "none" };
      const owner = rustTypeFromCarrierInContext(carrier, context, "absence")
        ?? failRustPlannerInvariant("An admitted absence requires its exact native Option type.");
      return { kind: "associated-value", owner, name: "None" };
    }
    case "custom": return planRustOptionalStorageOperation(carrier, "absent", [], context);
    case "union": if (storage.absence !== undefined) return planRustUnionConstruction(storage.absence,
      { kind: "tuple-literal", elements: [] }, context) ?? failRustPlannerInvariant("An admitted union absence requires its native construction.");
  }
  return failRustPlannerInvariant("An admitted absence requires its native optional storage.");
}

export function planRustPresentValue(carrier: TargetTypeRef, value: RustExpr, context: RustTypeRenderingContext): RustExpr {
  const storage = context.input.program.records.typeEmission.get(carrier)?.optionalStorage;
  if (storage?.kind === "custom") return planRustOptionalStorageOperation(carrier, "present", [value], context);
  if (storage?.kind === "option") return { kind: "call", path: "Some", args: [value] };
  return failRustPlannerInvariant("An admitted present value requires its native optional storage.");
}
