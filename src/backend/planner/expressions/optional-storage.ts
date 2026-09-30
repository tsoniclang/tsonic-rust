import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionalStorageValue, rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";
import { isRustAbsenceCarrier, isRustOptionCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import { rustRuntimeUnionContract } from "../../../target-model/types/carriers/runtime-unions.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustOptionTargetType, rustOptionElementCarrier, isRustJsValueCarrier } from "../../../target-model/types/index.js";

export function planRustOptionalStorageOperation(
  carrier: TargetTypeRef,
  method: "present" | "absent" | "is_absent" | "into_present" | "clone_present",
  args: readonly RustExpr[],
  context: RustTypeRenderingContext,
): RustExpr {
  const value = rustOptionalStorageValue(carrier);
  if (value === undefined) throw new Error("A native optional operation lost its storage contract.");
  return planOptionalStorageCall(carrier, value, method, args, context);
}

export function planRustCheckedSourceOptional(
  expression: RustExpr,
  element: TargetTypeRef,
  context: RustTypeRenderingContext,
): RustExpr {
  const storage = rustSourceOptionalTargetType(element);
  if (rustTargetTypeRefEquals(storage, rustOptionTargetType(element))) return expression;
  if (rustOptionElementCarrier(element) !== undefined && rustTargetTypeRefEquals(storage, element)) {
    if (rustOptionalStorageValue(element) !== undefined) {
      return { kind: "method-call", receiver: expression, method: "unwrap_or_else", args: [{ kind: "closure", params: [],
        body: planRustOptionalStorageOperation(element, "absent", [], context) }] };
    }
    return { kind: "method-call", receiver: expression, method: "flatten", args: [] };
  }
  if (isRustJsValueCarrier(element)) {
    context.usedAliases?.add("js_abi");
    return { kind: "method-call", receiver: expression, method: "unwrap_or", args: [{ kind: "path", path: "js_abi::JsValue::Null" }] };
  }
  return planOptionalStorageCall(storage, element, "from_option", [expression], context);
}

function planOptionalStorageCall(
  carrier: TargetTypeRef,
  value: TargetTypeRef,
  method: string,
  args: readonly RustExpr[],
  context: RustTypeRenderingContext,
): RustExpr {
  const owner = rustTypeFromCarrierInContext(carrier, context);
  const valueType = rustTypeFromCarrierInContext(value, context);
  if (owner === undefined || valueType === undefined) {
    throw new Error("A native optional storage operation lost its finalized value and storage types.");
  }
  context.usedAliases?.add("rt");
  return { kind: "associated-call", owner, method, args,
    trait: { kind: "named", path: "rt::OptionalStorage", genericArguments: [{ kind: "type", type: valueType }] } };
}

export function planRustAbsentValue(carrier: TargetTypeRef, context: RustTypeRenderingContext): RustExpr {
  if (isRustAbsenceCarrier(carrier)) return { kind: "tuple-literal", elements: [] };
  if (rustOptionalStorageValue(carrier) !== undefined) return planRustOptionalStorageOperation(carrier, "absent", [], context);
  if (isRustOptionCarrier(carrier)) return { kind: "none" };
  const unitArms = rustRuntimeUnionContract(carrier)?.alternatives.filter(alternative =>
    alternative.variant.kind === "payload" && isRustUnitCarrier(alternative.carrier));
  if (unitArms?.length === 1) {
    const owner = rustTypeFromCarrierInContext(carrier, context);
    if (owner?.kind === "named") return {
      kind: "call", path: `${owner.path}::${unitArms[0]!.variant.name}`,
      args: [{ kind: "tuple-literal", elements: [] }],
    };
  }
  throw new Error("A source absence requires finalized native optional storage.");
}

export function planRustPresentValue(
  carrier: TargetTypeRef, value: RustExpr, context: RustTypeRenderingContext,
): RustExpr {
  if (rustOptionalStorageValue(carrier) !== undefined) return planRustOptionalStorageOperation(carrier, "present", [value], context);
  if (isRustOptionCarrier(carrier)) return { kind: "call", path: "Some", args: [value] };
  throw new Error("A source present value requires finalized native optional storage.");
}
