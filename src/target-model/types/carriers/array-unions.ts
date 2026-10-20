import type { TargetTypeRef } from "../model.js";
import type { RustTypeDefinitions } from "../source-union-definitions.js";
import { rustSourceUnionCarrierValue } from "./source-types.js";
import { isRustJsArrayCarrier, rustJsArrayLikeElementTargetType, rustJsTypedArrayName } from "./js.js";

export function isRustNumberArrayPayload(carrier: TargetTypeRef | undefined): boolean {
  const element = rustJsArrayLikeElementTargetType(carrier);
  return isRustJsArrayCarrier(carrier) && element?.kind === "source-primitive" && element.name === "float64" ||
    rustJsTypedArrayName(carrier) !== undefined;
}

export function isRustNumberArrayUnion(carrier: TargetTypeRef | undefined, definitions: RustTypeDefinitions): boolean {
  if (carrier === undefined || rustSourceUnionCarrierValue(carrier)?.origin !== "generated") return false;
  const variants = definitions.sourceUnionVariants(carrier);
  return variants !== undefined && variants.length >= 2 && variants.every(variant => isRustNumberArrayPayload(variant.carrier));
}
