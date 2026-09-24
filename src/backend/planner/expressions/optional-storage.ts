import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { isRustAbsenceCarrier, isRustOptionCarrier } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";

export function planRustOptionalStorageOperation(
  carrier: TargetTypeRef,
  method: "present" | "absent" | "is_absent" | "into_present" | "clone_present",
  args: readonly RustExpr[],
  context: RustTypeRenderingContext,
): RustExpr {
  const value = rustOptionalStorageValue(carrier);
  const owner = rustTypeFromCarrierInContext(carrier, context);
  const valueType = rustTypeFromCarrierInContext(value, context);
  if (value === undefined || owner === undefined || valueType === undefined) {
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
  throw new Error("A source absence requires finalized native optional storage.");
}
