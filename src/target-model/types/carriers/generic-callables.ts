import type { TargetTypeRef } from "../model.js";
import { hasExactObjectKeys, isDenseDataArray, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../equality.js";
import { rustTargetGenericReferences } from "./generic-references.js";
import {
  isRustCallableOrigin, isRustCallableSignatureBinding, rustCallableSignatureBinding, rustCallableSignatureProtocol,
  type RustCallableOrigin, type RustCallableSignature,
} from "./callable-signatures.js";
import { rustFutureOutputCarrier, rustFutureTargetId } from "./primitives.js";
import { rustOptionElementCarrier } from "./optional.js";
import { isRustGenericCallableStorage, type RustGenericCallableStorage } from "./generic-callable-storage.js";

export interface RustGenericCallableValue {
  readonly origin: RustCallableOrigin;
  readonly signature: RustCallableSignature;
  readonly environment: readonly TargetTypeRef[];
  readonly retainedEnvironment: readonly TargetTypeRef[];
  readonly physical?: RustGenericCallableStorage;
}

export function rustGenericCallableTargetType(
  typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[],
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  origin: RustCallableOrigin,
  environmentInputs: readonly TargetTypeRef[] = [],
): TargetTypeRef | undefined {
  const binding = rustCallableSignatureBinding(typeParameters, parameters, result);
  if (binding === undefined || !isRustCallableOrigin(origin) ||
    !isDenseDataArray(environmentInputs) || !environmentInputs.every(isRustTargetTypeRef) ||
    typeParameters.length === 0 && rustNativeFutureCallableResult(result) === undefined) return undefined;
  const invocation = new Set([...typeParameters, ...binding.environment]
    .flatMap(type => rustTargetGenericReferences(type).typeIdentities));
  const retainedEnvironment = rustTargetGenericReferences({ kind: "tuple", elements: environmentInputs })
    .typeParameters.filter(parameter => !invocation.has(parameter.identity));
  return rustGenericCallableCarrier({ origin, ...binding, retainedEnvironment });
}

export function rebindRustGenericCallableCarrier(
  carrier: TargetTypeRef,
  typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[],
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  environmentInputs: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  const generic = rustGenericCallableValue(carrier);
  if (generic === undefined) return undefined;
  const rebound = rustGenericCallableTargetType(typeParameters, parameters, result, generic.origin, environmentInputs);
  const selected = rustGenericCallableValue(rebound);
  if (selected === undefined) return undefined;
  const retainedEnvironment = [...generic.retainedEnvironment];
  for (const type of selected.retainedEnvironment)
    if (!retainedEnvironment.some(retained => rustTargetTypeRefEquals(retained, type))) retainedEnvironment.push(type);
  return rustGenericCallableCarrier({ ...selected, retainedEnvironment });
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
    !hasExactObjectKeys(value, ["environment", "retainedEnvironment", "signature", "origin",
      ...(Object.prototype.hasOwnProperty.call(value, "physical") ? ["physical"] : [])])) return undefined;
  const selected = value as Partial<RustGenericCallableValue>;
  const binding = { signature: selected.signature, environment: selected.environment };
  if (!isRustCallableOrigin(selected.origin) || !isRustCallableSignatureBinding(binding) ||
    !isDenseDataArray(selected.retainedEnvironment) || !selected.retainedEnvironment.every(isRustTargetTypeRef) ||
    Object.prototype.hasOwnProperty.call(value, "physical") && !isRustGenericCallableStorage(selected.physical) ||
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
