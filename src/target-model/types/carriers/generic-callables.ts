import type { TargetTypeRef } from "../model.js";
import { isRustTargetTypeRef } from "../equality.js";
import { hasExactObjectKeys, isDenseDataArray, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import { rustTargetGenericReferences, rustTargetTypeParameterIdentities } from "./generic-references.js";
import { substituteRustTargetTypeParameters } from "./substitution.js";
import { rustFutureOutputCarrier, rustFutureTargetId } from "./primitives.js";
import { rustOptionElementCarrier } from "./optional.js";

export interface RustGenericCallableSignature {
  readonly typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly environmentParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
}

export interface RustGenericCallableValue {
  readonly origin: RustGenericCallableOrigin;
  readonly signature: RustGenericCallableSignature;
  readonly environment: readonly TargetTypeRef[];
}

export interface RustGenericCallableOrigin {
  readonly fileName: string;
  readonly declarationIdentity: string;
}

export function rustGenericCallableTargetType(
  typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[],
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  origin: RustGenericCallableOrigin,
): TargetTypeRef | undefined {
  if (!isDenseDataArray(typeParameters) || typeParameters.some(parameter => !isRustTargetTypeRef(parameter) ||
    parameter.kind !== "type-parameter" || parameter.optionalStorageValue !== undefined)) return undefined;
  const bound = new Set(typeParameters.map(parameter => parameter.identity));
  if (bound.size !== typeParameters.length || typeParameters.length === 0 &&
    rustNativeFutureCallableResult(result) === undefined) return undefined;
  const free = [...new Map([...parameters, result].flatMap(type => rustTargetGenericReferences(type).typeParameters)
    .filter(parameter => !bound.has(parameter.identity)).map(parameter => [parameter.identity, parameter])).values()];
  const callParameters = typeParameters.map((_parameter, index) => protocolParameter("Call", index));
  const environmentParameters = free.map((_parameter, index) => protocolParameter("Environment", index));
  const normalized = [...callParameters, ...environmentParameters];
  const substitutions = new Map<string, TargetTypeRef>([...typeParameters, ...free].map((parameter, index) =>
    [parameter.identity, normalized[index]!]));
  return rustGenericCallableCarrier({
    origin,
    signature: {
      typeParameters: callParameters, environmentParameters,
      parameters: parameters.map(parameter => substituteRustTargetTypeParameters(parameter, substitutions)),
      result: substituteRustTargetTypeParameters(result, substitutions),
    },
    environment: free,
  });
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
  const origin = selected.origin;
  if (typeof origin !== "object" || origin === null || !hasExactObjectKeys(origin, ["fileName", "declarationIdentity"]) ||
    typeof origin.fileName !== "string" || origin.fileName.length === 0 ||
    typeof origin.declarationIdentity !== "string" || origin.declarationIdentity.length === 0) return undefined;
  const signature = selected.signature;
  if (typeof signature !== "object" || signature === null || Array.isArray(signature) ||
    !hasExactObjectKeys(signature, ["environmentParameters", "parameters", "result", "typeParameters"]) ||
    !isDenseDataArray(signature.typeParameters) ||
    signature.typeParameters.some((parameter, index) => !isProtocolParameter(parameter, "Call", index)) ||
    !isDenseDataArray(signature.environmentParameters) ||
    signature.environmentParameters.some((parameter, index) => !isProtocolParameter(parameter, "Environment", index)) ||
    !isDenseDataArray(signature.parameters) || !signature.parameters.every(isRustTargetTypeRef) ||
    !isRustTargetTypeRef(signature.result) || !isDenseDataArray(selected.environment) ||
    selected.environment.length !== signature.environmentParameters.length ||
    !selected.environment.every(isRustTargetTypeRef) || signature.typeParameters.length === 0 &&
    rustNativeFutureCallableResult(signature.result) === undefined) return undefined;
  const allowed = new Set([...signature.typeParameters, ...signature.environmentParameters].map(parameter => parameter.identity));
  if ([...signature.parameters, signature.result].flatMap(rustTargetTypeParameterIdentities)
    .some(name => !allowed.has(name))) return undefined;
  return selected as RustGenericCallableValue;
}

export function rustGenericCallableProtocol(
  carrier: TargetTypeRef | undefined,
  typeParameters?: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[],
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  const value = rustGenericCallableValue(carrier);
  if (value === undefined || typeParameters !== undefined &&
    typeParameters.length !== value.signature.typeParameters.length) return undefined;
  const substitutions = new Map<string, TargetTypeRef>(value.signature.environmentParameters.map((parameter, index) =>
    [parameter.identity, value.environment[index]!]));
  if (typeParameters !== undefined) value.signature.typeParameters.forEach((parameter, index) =>
    substitutions.set(parameter.identity, typeParameters[index]!));
  return {
    parameters: value.signature.parameters.map(parameter => substituteRustTargetTypeParameters(parameter, substitutions)),
    result: substituteRustTargetTypeParameters(value.signature.result, substitutions),
  };
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

function protocolParameter(scope: "Call" | "Environment", index: number): Extract<TargetTypeRef, { readonly kind: "type-parameter" }> {
  return Object.freeze({ kind: "type-parameter", identity: `generic-callable:${scope}:${index}`, name: `${scope}Type${index}` });
}

function isProtocolParameter(value: unknown, scope: "Call" | "Environment", index: number): boolean {
  const expected = protocolParameter(scope, index);
  return isRustTargetTypeRef(value) && value.kind === "type-parameter" &&
    value.identity === expected.identity && value.name === expected.name && value.optionalStorageValue === undefined;
}
