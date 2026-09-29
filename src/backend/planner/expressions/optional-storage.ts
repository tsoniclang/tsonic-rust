import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { isRustAbsenceCarrier, isRustOptionCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import { rustRuntimeUnionContract } from "../../../target-model/types/carriers/runtime-unions.js";
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
