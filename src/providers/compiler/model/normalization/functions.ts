import {
  genericParameterMap,
  normalizeGenerics,
  normalizeType,
  substituteRustCompilerGenerics,
  substituteRustCompilerType,
  type RustCompilerNormalizationContext,
  type RustCompilerSubstitutions,
} from "../rustdoc-types.js";
import {
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import { canonicalCompilerItemIdentity, ownedCompilerItemIdentity } from "../rustdoc-items.js";
import { emptyRustCompilerGenerics } from "../model.js";
import { normalizeMemberType } from "./associated-types.js";
import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
  RustCompilerParameter,
  RustCompilerTraitReference,
  RustCompilerType,
  RustCompilerTypeParameter,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustdocItemResolver } from "../rustdoc-items.js";

export function normalizeFunction(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  allowReceiver: true | undefined,
  options: {
    readonly outerGenerics?: RustCompilerGenerics;
    readonly outerParameters?: ReadonlyMap<string, RustCompilerGenericParameter>;
    readonly enclosingGenerics?: RustCompilerGenerics;
    readonly substitutions?: RustCompilerSubstitutions;
    readonly associatedTypeBindings?: ReadonlyMap<string, RustCompilerType>;
    readonly traitDispatch?: RustCompilerTraitReference;
    readonly selfType?: RustCompilerType;
    readonly memberOwner?: import("../model.js").RustCompilerItemIdentity;
    readonly resolveItem?: RustdocItemResolver;
  } = {},
): RustCompilerFunction {
  const name = requireString(item.name, "Rust function name");
  const identity = options.memberOwner === undefined
    ? canonicalCompilerItemIdentity(document, dependency, item)
    : ownedCompilerItemIdentity(dependency, options.memberOwner, item);
  const fn = requireInnerRecord(item, "function", `Rust function '${name}'`);
  const normalizedGenerics = normalizeGenerics(document, requireRecord(fn.generics, `${name}.generics`), {
    dependency,
    owner: identity,
    genericOwnerKind: "callable",
    ...(options.selfType === undefined ? {} : { selfType: options.selfType }),
    ...(options.traitDispatch === undefined ? {} : { traitDispatch: options.traitDispatch }),
    ...(options.outerParameters === undefined && options.outerGenerics === undefined
      ? {}
      : { parameters: options.outerParameters ?? genericParameterMap(options.outerGenerics!) }),
    ...(options.resolveItem === undefined ? {} : { resolveItem: options.resolveItem }),
  });
  const substitutions = options.substitutions;
  const generics = substitutions === undefined
    ? normalizedGenerics
    : substituteRustCompilerGenerics(normalizedGenerics, substitutions);
  const parameters = mergeParameterMaps(
    options.outerParameters?.values() ?? options.outerGenerics?.parameters ?? [],
    generics.parameters,
  );
  const context: RustCompilerNormalizationContext = {
    dependency,
    owner: identity,
    parameters,
    ...(options.selfType === undefined ? {} : { selfType: options.selfType }),
    ...(options.resolveItem === undefined ? {} : { resolveItem: options.resolveItem }),
    ...(options.traitDispatch === undefined ? {} : { traitDispatch: options.traitDispatch }),
  };
  const syntheticParameters = generics.parameters.filter(
    (parameter): parameter is RustCompilerTypeParameter =>
      parameter.kind === "type" && parameter.declarationKind === "synthetic",
  );
  let syntheticParameterIndex = 0;
  const normalizeSelectedType = (raw: unknown, position: string): RustCompilerType => {
    const normalized = normalizeType(document, raw, { ...context, position });
    const substituted = substitutions === undefined
      ? normalized
      : substituteRustCompilerType(normalized, substitutions);
    return normalizeMemberType(
      substituted,
      options.associatedTypeBindings ?? new Map(),
      options.traitDispatch,
    );
  };
  const normalizeParameterType = (raw: unknown, position: string): RustCompilerType => {
    const normalized = normalizeSelectedType(raw, position);
    if (normalized.kind !== "opaque") return normalized;
    const parameter = syntheticParameters[syntheticParameterIndex];
    if (parameter === undefined) {
      throw new Error(`Rust function '${name}' has argument-position impl Trait without its rustdoc synthetic generic parameter.`);
    }
    syntheticParameterIndex += 1;
    return Object.freeze({
      kind: "type-parameter",
      identity: parameter.identity,
      displayName: parameter.displayName,
    });
  };
  const signature = requireRecord(fn.sig, `${name}.sig`);
  const rawInputs = requireArray(signature.inputs, `${name}.inputs`);
  let receiver: RustCompilerFunction["receiver"];
  const selectedParameters: RustCompilerParameter[] = [];
  for (let index = 0; index < rawInputs.length; index += 1) {
    const pair = rawInputs[index];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
      throw new Error(`Rust function '${name}' input ${index} has an invalid rustdoc shape.`);
    }
    const type = normalizeParameterType(pair[1], `parameter-${index}`);
    if (index === 0 && pair[0] === "self") {
      if (allowReceiver !== true) {
        throw new Error(`Free Rust function '${name}' unexpectedly declares a self receiver.`);
      }
      receiver = Object.freeze({
        type,
        explicit: !isShorthandReceiver(type),
      });
      continue;
    }
    selectedParameters.push(Object.freeze({ name: pair[0], type }));
  }
  if (syntheticParameterIndex !== syntheticParameters.length) {
    throw new Error(`Rust function '${name}' has rustdoc synthetic generic parameters without matching argument-position impl Trait inputs.`);
  }
  const header = requireRecord(fn.header, `${name}.header`);
  const asynchronous = header.is_async === true;
  const abi = normalizeAbi(header.abi, `${name}.header.abi`);
  const safety = requireBoolean(header.is_unsafe, `${name}.header.is_unsafe`)
    ? "unsafe" as const
    : "safe" as const;
  return Object.freeze({
    identity,
    name,
    parameters: Object.freeze(selectedParameters),
    result: signature.output === null
      ? Object.freeze({ kind: "unit" })
      : normalizeSelectedType(signature.output, "result"),
    enclosingGenerics: options.enclosingGenerics ?? options.outerGenerics ?? emptyRustCompilerGenerics,
    generics,
    ...(receiver === undefined ? {} : { receiver }),
    ...(options.traitDispatch === undefined ? {} : { traitDispatch: options.traitDispatch }),
    asynchronous,
    safety,
    abi,
    variadic: requireBoolean(signature.is_c_variadic, `${name}.sig.is_c_variadic`),
  });
}

function mergeParameterMaps(
  outer: Iterable<RustCompilerGenericParameter>,
  inner: readonly RustCompilerGenericParameter[],
): ReadonlyMap<string, RustCompilerGenericParameter> {
  const selected = new Map<string, RustCompilerGenericParameter>();
  for (const parameter of [...outer, ...inner]) {
    const name = parameter.kind === "lifetime"
      ? parameter.identity.kind === "parameter" || parameter.identity.kind === "bound"
        ? parameter.identity.displayName
        : "static"
      : parameter.displayName;
    if (selected.has(name)) {
      throw new Error(`Rust callable generic parameter '${name}' shadows an outer parameter.`);
    }
    selected.set(name, parameter);
  }
  return selected;
}

function isShorthandReceiver(type: RustCompilerType): boolean {
  if (type.kind === "self") return true;
  return type.kind === "reference" && type.target.kind === "self";
}
