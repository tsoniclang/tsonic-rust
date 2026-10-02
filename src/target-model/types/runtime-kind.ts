import type { TargetTypeRef } from "./model.js";
import type { RustTypeDefinitions } from "./source-union-definitions.js";
import { closedMetadataKey } from "../metadata/closed-data.js";
import { rustRuntimeUnionContract } from "./carriers/runtime-unions.js";
import {
  isRustAbsenceCarrier, isRustBigIntCarrier, isRustCallableCarrier,
  isRustNumericCarrier, isRustStringCarrier, isRustUnitCarrier, isRustJsValueCarrier, rustJsSymbolTargetId,
  rustOptionElementCarrier, rustSourceTypeCarrierValue,
  rustTsValueTargetId,
} from "./index.js";

export type RustTypeofResult =
  | "boolean" | "number" | "bigint" | "string" | "symbol" | "function" | "object" | "undefined"
  | { readonly kind: "runtime-method"; readonly method: string; readonly sourceCarrier: TargetTypeRef }
  | { readonly kind: "optional"; readonly sourceCarrier: TargetTypeRef; readonly value: RustTypeofResult }
  | { readonly kind: "source-union"; readonly sourceCarrier: TargetTypeRef;
      readonly variants: readonly { readonly name: string; readonly carrier: TargetTypeRef; readonly result: RustTypeofResult }[] };

export function getRustTypeofRuntimeKind(
  carrier: TargetTypeRef,
  definitions: RustTypeDefinitions,
  active: ReadonlySet<string> = new Set(),
): RustTypeofResult | undefined {
  const identity = closedMetadataKey(carrier);
  if (active.has(identity)) return undefined;
  const optional = rustOptionElementCarrier(carrier);
  if (optional !== undefined) {
    const value = getRustTypeofRuntimeKind(optional, definitions, new Set(active).add(identity));
    return value === undefined ? undefined : { kind: "optional", sourceCarrier: carrier, value };
  }
  const runtimeUnion = rustRuntimeUnionContract(carrier);
  const method = isRustJsValueCarrier(carrier) || carrier.kind === "target-named" && carrier.id === rustTsValueTargetId
    ? "type_of" : runtimeUnion?.typeofMethod;
  if (method !== undefined) {
    return { kind: "runtime-method", method, sourceCarrier: carrier };
  }
  const sourceVariants = definitions.sourceUnionVariants(carrier) ??
    (runtimeUnion?.alternatives.every(arm => arm.variant.kind === "payload") === true
      ? runtimeUnion.alternatives.map(arm => ({ name: arm.variant.name, carrier: arm.carrier })) : undefined);
  if (sourceVariants !== undefined) {
    const nested = new Set(active).add(identity);
    const variants = sourceVariants.map(variant => {
      const result = getRustTypeofRuntimeKind(variant.carrier, definitions, nested);
      return result === undefined ? undefined : { ...variant, result };
    });
    return variants.some(variant => variant === undefined) ? undefined
      : { kind: "source-union", sourceCarrier: carrier, variants: variants.map(variant => variant!) };
  }
  if (isRustAbsenceCarrier(carrier)) return "object";
  if (carrier.kind === "source-primitive") {
    if (carrier.name === "bool") return "boolean";
    if (carrier.name === "int64" || carrier.name === "uint64") return "bigint";
    return isRustNumericCarrier(carrier) ? "number" : undefined;
  }
  if (isRustStringCarrier(carrier)) return "string";
  if (carrier.kind === "target-named" && carrier.id === rustJsSymbolTargetId) return "symbol";
  if (isRustBigIntCarrier(carrier)) return "bigint";
  if (isRustUnitCarrier(carrier)) return "undefined";
  if (isRustCallableCarrier(carrier)) return "function";
  const sourceType = rustSourceTypeCarrierValue(carrier);
  if (sourceType?.shape === "enum" || carrier.kind === "type-parameter" || carrier.kind === "associated-type") {
    return undefined;
  }
  return "object";
}
