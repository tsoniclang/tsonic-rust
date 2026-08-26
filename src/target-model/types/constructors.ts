import type {
  RustAbi,
  RustBound,
  RustCapturedGeneric,
  RustConstExpr,
  RustGenericArgument,
  RustLifetimeRef,
  RustSemanticIdentity,
} from "../semantics/index.js";
import {
  compareRustCapturedGenerics,
  rustBuiltinIdentity,
  rustStaticLifetime,
} from "../semantics/index.js";
import type { TargetTypeRef } from "./model.js";

export function rustInferredLifetime(regionId: string): RustLifetimeRef {
  if (regionId.length === 0) {
    throw new Error("Rust inferred lifetimes require one exact non-empty region identity.");
  }
  return Object.freeze({ kind: "inferred-region", regionId });
}

export function rustTypeArgument(value: TargetTypeRef): RustGenericArgument {
  return Object.freeze({ kind: "type", value });
}

export function rustLifetimeArgument(value: RustLifetimeRef): RustGenericArgument {
  return Object.freeze({ kind: "lifetime", value });
}

export function rustConstArgument(value: RustConstExpr): RustGenericArgument {
  return Object.freeze({ kind: "const", value });
}

export function rustPathTargetType(options: {
  readonly identity: RustSemanticIdentity;
  readonly displayPath: readonly string[];
  readonly arguments?: readonly RustGenericArgument[];
}): TargetTypeRef {
  const arguments_ = options.arguments ?? [];
  return Object.freeze({
    kind: "path",
    identity: options.identity,
    displayPath: Object.freeze([...options.displayPath]),
    arguments: Object.freeze([...arguments_]),
  });
}

export function rustBuiltinPathTargetType(
  itemId: string,
  displayPath: string,
  typeArguments: readonly TargetTypeRef[] = [],
  namespace: "rust" | "tsonic-runtime" = "rust",
): TargetTypeRef {
  return rustPathTargetType({
    identity: rustBuiltinIdentity(itemId, namespace),
    displayPath: Object.freeze(displayPath.split("::")),
    arguments: Object.freeze(typeArguments.map(rustTypeArgument)),
  });
}

export function rustBuiltinGenericPathTargetType(
  itemId: string,
  displayPath: string,
  argumentsList: readonly RustGenericArgument[] = [],
  namespace: "rust" | "tsonic-runtime" = "rust",
): TargetTypeRef {
  return rustPathTargetType({
    identity: rustBuiltinIdentity(itemId, namespace),
    displayPath: Object.freeze(displayPath.split("::")),
    arguments: Object.freeze([...argumentsList]),
  });
}

export function rustBuiltinTypeIdentityItemId(
  type: TargetTypeRef | undefined,
  namespace: "rust" | "tsonic-runtime",
): string | undefined {
  return type?.kind === "path" && type.identity.kind === "builtin" &&
      type.identity.namespace === namespace
    ? type.identity.itemId
    : undefined;
}

export function rustPathTypeArguments(
  type: TargetTypeRef | undefined,
): readonly TargetTypeRef[] | undefined {
  if (type?.kind !== "path") return undefined;
  const argumentsList: TargetTypeRef[] = [];
  for (const argument of type.arguments) {
    if (argument.kind !== "type") return undefined;
    argumentsList.push(argument.value);
  }
  return Object.freeze(argumentsList);
}

export function rustPathGenericArguments(
  type: TargetTypeRef | undefined,
): readonly RustGenericArgument[] | undefined {
  return type?.kind === "path" ? type.arguments : undefined;
}

export function rustBuiltinPathTypeMatches(
  type: TargetTypeRef | undefined,
  itemId: string,
  namespace: "rust" | "tsonic-runtime",
): boolean {
  return rustBuiltinTypeIdentityItemId(type, namespace) === itemId;
}

export function rustReferenceTargetType(
  target: TargetTypeRef,
  mutable: boolean,
  lifetime: RustLifetimeRef,
): TargetTypeRef {
  return Object.freeze({ kind: "reference", lifetime, mutable, target });
}

export function rustRawPointerTargetType(
  target: TargetTypeRef,
  mutable: boolean,
): TargetTypeRef {
  return Object.freeze({ kind: "raw-pointer", mutable, target });
}

export function rustSequenceTargetType(element: TargetTypeRef): TargetTypeRef {
  return Object.freeze({ kind: "sequence", element });
}

export function rustFixedArrayType(
  element: TargetTypeRef,
  length: RustConstExpr,
): TargetTypeRef {
  return Object.freeze({ kind: "array", element, length });
}

export function rustTypeParameterTargetType(
  identity: RustSemanticIdentity,
  displayName: string,
): TargetTypeRef {
  return Object.freeze({ kind: "type-parameter", identity, displayName });
}

export function rustInferenceVariableTargetType(
  ownerId: string,
  slotId: string,
): TargetTypeRef {
  return Object.freeze({
    kind: "inference-variable",
    identity: Object.freeze({
      kind: "generated",
      artifactId: ownerId,
      itemId: slotId,
    }),
  });
}

export function rustFunctionPointerTargetType(options: {
  readonly binder?: import("../semantics/index.js").RustBinder;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly abi?: RustAbi;
  readonly safety?: "safe" | "unsafe";
  readonly variadic?: boolean;
}): TargetTypeRef {
  const abi = options.abi ?? "Rust";
  if (options.variadic === true && abi === "Rust") {
    throw new Error("Rust variadic function pointers require an explicit non-Rust ABI.");
  }
  return Object.freeze({
    kind: "function-pointer",
    ...(options.binder === undefined ? {} : { binder: options.binder }),
    safety: options.safety ?? "safe",
    abi,
    parameters: Object.freeze([...options.parameters]),
    variadic: options.variadic ?? false,
    result: options.result,
  });
}

export function rustClosureTargetType(options: {
  readonly binder?: import("../semantics/index.js").RustBinder;
  readonly callTrait: "fn" | "fn-mut" | "fn-once";
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
  readonly captures?: readonly RustCapturedGeneric[];
}): TargetTypeRef {
  return Object.freeze({
    kind: "closure",
    ...(options.binder === undefined ? {} : { binder: options.binder }),
    callTrait: options.callTrait,
    parameters: Object.freeze([...options.parameters]),
    result: options.result,
    captures: Object.freeze([...(options.captures ?? [])]),
  });
}

export function rustOpaqueTargetType(options: {
  readonly identity: RustSemanticIdentity;
  readonly bounds: readonly RustBound[];
  readonly captures?: readonly RustCapturedGeneric[];
}): TargetTypeRef {
  if (options.bounds.length === 0) {
    throw new Error("Rust opaque types require at least one exact bound.");
  }
  return Object.freeze({
    kind: "opaque",
    identity: options.identity,
    bounds: Object.freeze([...options.bounds]),
    captures: Object.freeze([...(options.captures ?? [])].sort(compareRustCapturedGenerics)),
  });
}

export function rustSourceCarrierTargetType(
  identity: RustSemanticIdentity,
  payload: Readonly<Record<string, unknown>>,
): TargetTypeRef {
  return Object.freeze({ kind: "source-carrier", identity, payload: Object.freeze(payload) });
}

export { rustStaticLifetime };
