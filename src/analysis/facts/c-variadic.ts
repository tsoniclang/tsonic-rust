import type { TargetTypeRef } from "../../target-model/types/model.js";
const cVariadicSourcePrimitives = new Set([
  "int32",
  "uint32",
  "int64",
  "uint64",
  "native-int",
  "native-uint",
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
  return carrier.kind === "raw-pointer" || carrier.kind === "function-pointer";
}
