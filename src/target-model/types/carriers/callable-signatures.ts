import type { TargetTypeRef } from "../model.js";
import { isRustTargetTypeRef } from "../equality.js";
import { hasExactObjectKeys, isDenseDataArray, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import { rustTargetGenericReferences, rustTargetTypeParameterIdentities } from "./generic-references.js";
import { substituteRustTargetTypeParameters } from "./substitution.js";

export interface RustCallableSignature {
  readonly typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly environmentParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
}

export interface RustCallableOrigin {
  readonly fileName: string;
  readonly declarationIdentity: string;
}

export interface RustCallableSignatureBinding {
  readonly signature: RustCallableSignature;
  readonly environment: readonly TargetTypeRef[];
}

export function rustCallableSignatureBinding(
  typeParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[],
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
  environmentInputs: readonly TargetTypeRef[] = [],
): RustCallableSignatureBinding | undefined {
  if (!isDenseDataArray(typeParameters) || typeParameters.some(parameter => !isRustTargetTypeRef(parameter) ||
    parameter.kind !== "type-parameter" || parameter.optionalStorageValue !== undefined) ||
    !isDenseDataArray(parameters) || !parameters.every(isRustTargetTypeRef) || !isRustTargetTypeRef(result) ||
    !isDenseDataArray(environmentInputs) || !environmentInputs.every(isRustTargetTypeRef)) return undefined;
  const bound = new Set(typeParameters.map(parameter => parameter.identity));
  if (bound.size !== typeParameters.length) return undefined;
  const free = [...new Map([...parameters, result, ...environmentInputs]
    .flatMap(type => rustTargetGenericReferences(type).typeParameters)
    .filter(parameter => !bound.has(parameter.identity)).map(parameter => [parameter.identity, parameter])).values()];
  const callParameters = typeParameters.map((_parameter, index) => protocolParameter("Call", index));
  const environmentParameters = free.map((_parameter, index) => protocolParameter("Environment", index));
  const normalized = [...callParameters, ...environmentParameters];
  const substitutions = new Map<string, TargetTypeRef>([...typeParameters, ...free].map((parameter, index) =>
    [parameter.identity, normalized[index]!]));
  return snapshotClosedMetadata({
    signature: {
      typeParameters: callParameters, environmentParameters,
      parameters: parameters.map(parameter => substituteRustTargetTypeParameters(parameter, substitutions)),
      result: substituteRustTargetTypeParameters(result, substitutions),
    },
    environment: free,
  });
}

export function isRustCallableOrigin(value: unknown): value is RustCallableOrigin {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["fileName", "declarationIdentity"])) return false;
  const selected = value as Partial<RustCallableOrigin>;
  return typeof selected.fileName === "string" && selected.fileName.length !== 0 &&
    typeof selected.declarationIdentity === "string" && selected.declarationIdentity.length !== 0;
}

export function isRustCallableSignatureBinding(value: unknown): value is RustCallableSignatureBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["environment", "signature"])) return false;
  const selected = value as Partial<RustCallableSignatureBinding>;
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
    !selected.environment.every(isRustTargetTypeRef)) return false;
  const allowed = new Set([...signature.typeParameters, ...signature.environmentParameters].map(parameter => parameter.identity));
  return ![...signature.parameters, signature.result].flatMap(rustTargetTypeParameterIdentities)
    .some(identity => !allowed.has(identity));
}

export function rustCallableSignatureProtocol(
  value: RustCallableSignatureBinding,
  typeArguments?: readonly TargetTypeRef[],
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  if (!isRustCallableSignatureBinding(value) || typeArguments !== undefined &&
    (!isDenseDataArray(typeArguments) || typeArguments.length !== value.signature.typeParameters.length ||
      !typeArguments.every(isRustTargetTypeRef))) return undefined;
  const substitutions = new Map<string, TargetTypeRef>(value.signature.environmentParameters.map((parameter, index) =>
    [parameter.identity, value.environment[index]!]));
  if (typeArguments !== undefined) value.signature.typeParameters.forEach((parameter, index) =>
    substitutions.set(parameter.identity, typeArguments[index]!));
  return {
    parameters: value.signature.parameters.map(parameter => substituteRustTargetTypeParameters(parameter, substitutions)),
    result: substituteRustTargetTypeParameters(value.signature.result, substitutions),
  };
}

function protocolParameter(scope: "Call" | "Environment", index: number): Extract<TargetTypeRef, { readonly kind: "type-parameter" }> {
  return Object.freeze({ kind: "type-parameter", identity: `generic-callable:${scope}:${index}`, name: `${scope}Type${index}` });
}

function isProtocolParameter(value: unknown, scope: "Call" | "Environment", index: number): boolean {
  const expected = protocolParameter(scope, index);
  return isRustTargetTypeRef(value) && value.kind === "type-parameter" &&
    value.identity === expected.identity && value.name === expected.name && value.optionalStorageValue === undefined;
}
