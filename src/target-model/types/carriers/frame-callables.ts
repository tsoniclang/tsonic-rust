import type { TargetTypeRef } from "../model.js";
import { hasExactObjectKeys, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import {
  isRustCallableOrigin, isRustCallableSignatureBinding, rustCallableSignatureBinding, rustCallableSignatureProtocol,
  type RustCallableOrigin, type RustCallableSignature,
} from "./callable-signatures.js";

export interface RustFrameCallableValue {
  readonly owner: RustCallableOrigin;
  readonly signature: RustCallableSignature;
  readonly environment: readonly TargetTypeRef[];
}

export function rustFrameCallableTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  owner: RustCallableOrigin,
  environmentInputs: readonly TargetTypeRef[] = [],
): TargetTypeRef | undefined {
  const binding = rustCallableSignatureBinding([], parameters, result, environmentInputs);
  return binding === undefined || !isRustCallableOrigin(owner) ? undefined : rustFrameCallableCarrier({ owner, ...binding });
}

export function rustFrameCallableCarrier(value: RustFrameCallableValue): TargetTypeRef {
  const carrier = { kind: "target-specific" as const, target: "rust" as const, name: "frame-callable", value };
  if (rustFrameCallableValue(carrier) === undefined)
    throw new Error("A frame callable requires an exact activation owner and closed native signature.");
  return Object.freeze({ ...carrier, value: snapshotClosedMetadata(value) });
}

export function rustFrameCallableValue(carrier: TargetTypeRef | undefined): RustFrameCallableValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "frame-callable") return undefined;
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["environment", "signature", "owner"])) return undefined;
  const selected = value as Partial<RustFrameCallableValue>;
  const binding = { signature: selected.signature, environment: selected.environment };
  return !isRustCallableOrigin(selected.owner) || !isRustCallableSignatureBinding(binding) ||
    binding.signature.typeParameters.length !== 0 ? undefined : selected as RustFrameCallableValue;
}

export function rustFrameCallableProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  const value = rustFrameCallableValue(carrier);
  return value === undefined ? undefined : rustCallableSignatureProtocol({ signature: value.signature,
    environment: value.environment }, []);
}
