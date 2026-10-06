import type { TargetTypeRef } from "../model.js";
import { hasExactObjectKeys, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import {
  isRustCallableOrigin, isRustCallableSignatureBinding, rustCallableSignatureBinding, rustCallableSignatureProtocol,
  type RustCallableOrigin, type RustCallableSignature,
} from "./callable-signatures.js";
import { rustFutureOutputCarrier, rustFutureTargetId } from "./primitives.js";
import { rustOptionElementCarrier } from "./optional.js";

export interface RustGenericCallableValue {
  readonly origin: RustCallableOrigin;
  readonly signature: RustCallableSignature;
  readonly environment: readonly TargetTypeRef[];
}

export function rustGenericCallableTargetType(
  typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[],
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  origin: RustCallableOrigin,
  environmentInputs: readonly TargetTypeRef[] = [],
): TargetTypeRef | undefined {
  const binding = rustCallableSignatureBinding(typeParameters, parameters, result, environmentInputs);
  return binding === undefined || !isRustCallableOrigin(origin) || typeParameters.length === 0 &&
    rustNativeFutureCallableResult(result) === undefined ? undefined : rustGenericCallableCarrier({ origin, ...binding });
}

export function rustGenericCallableCarrier(value: RustGenericCallableValue): TargetTypeRef {
  const carrier = { kind: "target-specific" as const, target: "rust" as const, name: "generic-callable", value };
  if (rustGenericCallableValue(carrier) === undefined) throw new Error("A generic callable requires an exact immutable origin and quantified signature.");
  return Object.freeze({ ...carrier, value: snapshotClosedMetadata(value) });
}

export function rustGenericCallableValue(carrier: TargetTypeRef | undefined): RustGenericCallableValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "generic-callable") return undefined;
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["environment", "signature", "origin"])) return undefined;
  const selected = value as Partial<RustGenericCallableValue>;
  const binding = { signature: selected.signature, environment: selected.environment };
  if (!isRustCallableOrigin(selected.origin) || !isRustCallableSignatureBinding(binding) ||
    binding.signature.typeParameters.length === 0 && rustNativeFutureCallableResult(binding.signature.result) === undefined) return undefined;
  return selected as RustGenericCallableValue;
}

export function rustGenericCallableProtocol(
  carrier: TargetTypeRef | undefined,
  typeArguments?: readonly TargetTypeRef[],
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  const value = rustGenericCallableValue(carrier);
  return value === undefined ? undefined : rustCallableSignatureProtocol({ signature: value.signature,
    environment: value.environment }, typeArguments);
}

export function rustNativeFutureCallableResult(
  result: TargetTypeRef,
): { readonly output: TargetTypeRef; readonly optional: boolean } | undefined {
  const optional = rustOptionElementCarrier(result);
  const future = optional ?? result;
  if (future.kind !== "target-named" || future.id !== rustFutureTargetId) return undefined;
  const output = rustFutureOutputCarrier(future);
  return output === undefined ? undefined : { output, optional: optional !== undefined };
}
