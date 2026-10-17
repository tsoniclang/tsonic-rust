import type { RustLifetimeBinder, RustLifetimeParameterContract, RustLifetimeRef } from "./model.js";

export function rustLifetimeKey(lifetime: RustLifetimeRef): string {
  switch (lifetime.kind) {
    case "static":
      return "static";
    case "placeholder":
      return "placeholder";
    case "call-scoped-elision":
      return `call-scoped-elision\0${lifetime.callIdentity}\0${lifetime.parameterIdentity}`;
    case "parameter":
      return `parameter\0${lifetime.identity}`;
    case "bound":
      return `bound\0${lifetime.binderIdentity}\0${lifetime.identity}`;
  }
}

export function rustLifetimesEqual(
  left: RustLifetimeRef | undefined,
  right: RustLifetimeRef | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : rustLifetimeKey(left) === rustLifetimeKey(right);
}

export function rustLifetimeName(lifetime: RustLifetimeRef): string {
  switch (lifetime.kind) {
    case "static":
      return "static";
    case "placeholder":
      return "_";
    case "call-scoped-elision":
      return "_";
    case "parameter":
    case "bound":
      return lifetime.name;
  }
}

export function isRustLifetimeRef(value: unknown): value is RustLifetimeRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<RustLifetimeRef>;
  const keys = Object.keys(value).sort();
  switch (candidate.kind) {
    case "static":
    case "placeholder":
      return keys.length === 1 && keys[0] === "kind";
    case "call-scoped-elision":
      return keys.length === 3 && keys[0] === "callIdentity" && keys[1] === "kind" &&
        keys[2] === "parameterIdentity" && nonEmptyString(candidate.callIdentity) &&
        nonEmptyString(candidate.parameterIdentity);
    case "parameter":
      return keys.length === 3 && keys[0] === "identity" && keys[1] === "kind" &&
        keys[2] === "name" && nonEmptyString(candidate.identity) &&
        nonEmptyString(candidate.name);
    case "bound":
      return keys.length === 4 && keys[0] === "binderIdentity" &&
        keys[1] === "identity" && keys[2] === "kind" && keys[3] === "name" &&
        nonEmptyString(candidate.binderIdentity) && nonEmptyString(candidate.identity) &&
        nonEmptyString(candidate.name);
    default:
      return false;
  }
}

export function rustCallScopedElisionLifetime(
  callIdentity: string,
  parameterIdentity: string,
): Extract<RustLifetimeRef, { readonly kind: "call-scoped-elision" }> {
  if (callIdentity.length === 0 || parameterIdentity.length === 0) {
    throw new Error("Rust call-scoped lifetime elision requires exact call and parameter identities.");
  }
  return Object.freeze({
    kind: "call-scoped-elision",
    callIdentity,
    parameterIdentity,
  });
}

export function rustFunctionValueLifetimeBinding(
  declarationIdentity: string,
  parameters: readonly RustLifetimeParameterContract[],
): { readonly binder: RustLifetimeBinder; readonly substitutions: ReadonlyMap<string, RustLifetimeRef> } | undefined {
  if (declarationIdentity.length === 0 || parameters.length === 0 ||
    parameters.some(parameter => parameter.lifetime.kind !== "parameter") ||
    new Set(parameters.map(parameter => rustLifetimeKey(parameter.lifetime))).size !== parameters.length) return undefined;
  const binderIdentity = `function-value-lifetime-binder\0${declarationIdentity}`;
  const lifetimes = parameters.map((parameter, index) => ({
    parameter,
    bound: Object.freeze({
      kind: "bound" as const,
      binderIdentity,
      identity: `${binderIdentity}\0${index}`,
      name: parameter.lifetime.name,
    }),
  }));
  const substitutions = new Map<string, RustLifetimeRef>(lifetimes.map(({ parameter, bound }) => [
    rustLifetimeKey(parameter.lifetime), bound,
  ] as const));
  return Object.freeze({
    binder: Object.freeze({
      identity: binderIdentity,
      parameters: Object.freeze(lifetimes.map(({ parameter, bound }) => Object.freeze({
        lifetime: bound,
        outlives: Object.freeze(parameter.outlives.map(lifetime =>
          lifetime.kind === "parameter" ? substitutions.get(rustLifetimeKey(lifetime)) ?? lifetime : lifetime)),
      }))),
    }),
    substitutions,
  });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
