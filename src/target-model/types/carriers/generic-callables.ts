import type { TargetTypeRef } from "../model.js";
import { isRustTargetTypeRef } from "../equality.js";
import { hasExactObjectKeys, isDenseDataArray, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import { rustTargetTypeParameterNames } from "./generic-references.js";
import { substituteRustTargetTypeParameters } from "./substitution.js";

export interface RustGenericCallableSignature {
  readonly typeParameters: readonly string[];
  readonly environmentParameters: readonly string[];
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
  typeParameters: readonly string[],
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  origin: RustGenericCallableOrigin,
): TargetTypeRef | undefined {
  if (typeParameters.length === 0 || new Set(typeParameters).size !== typeParameters.length) return undefined;
  const bound = new Set(typeParameters);
  const free = [...new Set([...parameters, result].flatMap(rustTargetTypeParameterNames))]
    .filter(name => !bound.has(name));
  const callNames = typeParameters.map((_name, index) => `CallType${index}`);
  const environmentNames = free.map((_name, index) => `EnvironmentType${index}`);
  const substitutions = new Map<string, TargetTypeRef>([...typeParameters, ...free].map((name, index) =>
    [name, { kind: "type-parameter", name: [...callNames, ...environmentNames][index]! }]));
  return rustGenericCallableCarrier({
    origin,
    signature: {
      typeParameters: callNames, environmentParameters: environmentNames,
      parameters: parameters.map(parameter => substituteRustTargetTypeParameters(parameter, substitutions)),
      result: substituteRustTargetTypeParameters(result, substitutions),
    },
    environment: free.map(name => ({ kind: "type-parameter", name })),
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
    !isDenseDataArray(signature.typeParameters) || signature.typeParameters.length === 0 ||
    signature.typeParameters.some((name, index) => name !== `CallType${index}`) ||
    !isDenseDataArray(signature.environmentParameters) ||
    signature.environmentParameters.some((name, index) => name !== `EnvironmentType${index}`) ||
    !isDenseDataArray(signature.parameters) || !signature.parameters.every(isRustTargetTypeRef) ||
    !isRustTargetTypeRef(signature.result) || !isDenseDataArray(selected.environment) ||
    selected.environment.length !== signature.environmentParameters.length ||
    !selected.environment.every(isRustTargetTypeRef)) return undefined;
  const allowed = new Set([...signature.typeParameters, ...signature.environmentParameters]);
  if ([...signature.parameters, signature.result].flatMap(rustTargetTypeParameterNames)
    .some(name => !allowed.has(name))) return undefined;
  return selected as RustGenericCallableValue;
}

export function rustGenericCallableProtocol(
  carrier: TargetTypeRef | undefined,
  typeParameterNames?: readonly string[],
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  const value = rustGenericCallableValue(carrier);
  if (value === undefined || typeParameterNames !== undefined &&
    typeParameterNames.length !== value.signature.typeParameters.length) return undefined;
  const substitutions = new Map<string, TargetTypeRef>(value.signature.environmentParameters.map((name, index) =>
    [name, value.environment[index]!]));
  if (typeParameterNames !== undefined) value.signature.typeParameters.forEach((name, index) =>
    substitutions.set(name, { kind: "type-parameter", name: typeParameterNames[index]! }));
  return {
    parameters: value.signature.parameters.map(parameter => substituteRustTargetTypeParameters(parameter, substitutions)),
    result: substituteRustTargetTypeParameters(value.signature.result, substitutions),
  };
}
