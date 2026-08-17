import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustIsizeTargetId,
  rustUsizeTargetId,
} from "../rust-target-types.js";

const cVariadicSourcePrimitives = new Set([
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float64",
]);

export function isRustCVariadicArgumentCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is TargetTypeRef {
  if (carrier === undefined) {
    return false;
  }
  if (carrier.kind === "source-primitive") {
    return cVariadicSourcePrimitives.has(carrier.name);
  }
  if (carrier.kind === "target-named") {
    return carrier.typeArguments === undefined &&
      (carrier.id === rustIsizeTargetId || carrier.id === rustUsizeTargetId);
  }
  return carrier.kind === "pointer" || carrier.kind === "function-pointer";
}
