import { rustNamedTypeCarrierValue } from "../types/carriers/native.js";
import { rustCallableTargetId } from "../types/carriers/source-types.js";
import { isRustTargetTypeRef } from "../types/equality.js";
import { rustOnlyTypeGenericArguments } from "../types/generic-arguments.js";
import type { TargetTypeRef } from "../types/model.js";
import { type RustNativeErrorSource } from "../types/native-error-joins.js";

import { type RustCallableConversion } from "./callable.js";

import { type RustValueConversionContract } from "./contracts.js";
import { rustCallableProtocol } from "../types/carriers/callables.js";

export interface RustCallablePhysicalSignature {
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly error: TargetTypeRef;
}

export type RustCallablePhysicalValueConversion =
  | { readonly kind: "identity" | "borrow" | "absence" | "discard" }
  | { readonly kind: "value"; readonly contract: RustValueConversionContract; readonly errorIdentity?: string }
  | { readonly kind: "callable"; readonly conversion: RustCallablePhysicalConversion };

export interface RustCallablePhysicalConversion extends RustCallablePhysicalSignature {
  readonly logical: RustCallableConversion;
  readonly source: RustCallablePhysicalSignature;
  readonly carrier: TargetTypeRef;
  readonly arguments: readonly RustCallablePhysicalValueConversion[];
  readonly resultPlan: RustCallablePhysicalValueConversion;
  readonly errors: readonly RustNativeErrorSource<TargetTypeRef>[];
  /** The invoked callable's error conversion when the logical adapter converts errors. */
  readonly errorPlan?: RustValueConversionContract;
  /** The invoked callable's error is uninhabited; the adapter eliminates it into the target's runtime error. */
  readonly eliminatedInvokeError?: true;
}

export function rustCallablePhysicalSignature(carrier: TargetTypeRef): RustCallablePhysicalSignature | undefined {
  if (!isRustTargetTypeRef(carrier)) return undefined;
  const named = rustNamedTypeCarrierValue(carrier);
  const arguments_ = named?.id === rustCallableTargetId && named.genericArguments?.[0]?.kind === "lifetime"
    ? rustOnlyTypeGenericArguments(named.genericArguments.slice(1)) : undefined;
  const tuple = arguments_?.length === 2 ? arguments_[0]
    : carrier.kind === "closure" && carrier.fallible !== true && carrier.args.length === 1 ? carrier.args[0] : undefined;
  const resultCarrier = tuple?.kind === "tuple" ? arguments_?.[1] ?? (carrier.kind === "closure" ? carrier.result : undefined) : undefined;
  const result = rustNamedTypeCarrierValue(resultCarrier);
  const resultArguments = result?.id === "rust.core.Result" ? rustOnlyTypeGenericArguments(result.genericArguments) : undefined;
  return tuple?.kind !== "tuple" || resultArguments?.length !== 2 ? undefined : Object.freeze({
    parameters: tuple.elements, result: resultArguments[0]!, error: resultArguments[1]!,
  });
}

export function rustCallableConversionSource(carrier: TargetTypeRef): ReturnType<typeof rustCallableProtocol> {
  const physical = rustCallablePhysicalSignature(carrier);
  if (physical === undefined) return rustCallableProtocol(carrier);
  const named = rustNamedTypeCarrierValue(carrier);
  const lifetime = named?.genericArguments?.[0];
  return Object.freeze({ ...physical, ...(lifetime?.kind === "lifetime" ? { lifetime: lifetime.lifetime } : {}) });
}
