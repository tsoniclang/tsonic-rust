import {
  compilerTypeRequirementConditions,
  mergeTypeParameterRequirements,
  normalizeTypeParameters,
  normalizeTraitDispatch,
} from "../rustdoc-types.js";
import {
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import { canonicalItemId } from "../rustdoc-items.js";
import { normalizeMemberType } from "./associated-types.js";
import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerParameter,
  RustCompilerType,
  RustCompilerTypeParameter,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export function normalizeFunction(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  allowReceiver: true | undefined,
  inheritedRequirements: readonly RustCompilerTypeParameter[] = Object.freeze([]),
  options: {
    readonly implementationBindings?: ReadonlyMap<string, RustCompilerType>;
    readonly associatedTypeBindings?: ReadonlyMap<string, RustCompilerType>;
    readonly traitDispatch?: ReturnType<typeof normalizeTraitDispatch>;
  } = {},
): RustCompilerFunction {
  const name = requireString(item.name, "Rust function name");
  const fn = requireInnerRecord(item, "function", `Rust function '${name}'`);
  const signature = requireRecord(fn.sig, `${name}.sig`);
  const variadic = requireBoolean(signature.is_c_variadic, `${name}.sig.is_c_variadic`);
  const header = requireRecord(fn.header, `${name}.header`);
  const unsafe = requireBoolean(header.is_unsafe, `${name}.header.is_unsafe`);
  const abi = normalizeAbi(header.abi, `${name}.header.abi`);
  const generics = requireRecord(fn.generics, `${name}.generics`);
  const typeParameters = normalizeTypeParameters(document, generics);
  const implementationBindings = options.implementationBindings ?? new Map<string, RustCompilerType>();
  const associatedTypeBindings = options.associatedTypeBindings ?? new Map<string, RustCompilerType>();
  const normalizeSelectedType = (raw: unknown): RustCompilerType => normalizeMemberType(
    document,
    raw,
    implementationBindings,
    associatedTypeBindings,
    options.traitDispatch,
  );
  const rawInputs = requireArray(signature.inputs, `${name}.inputs`);
  let receiver: RustCompilerFunction["receiver"];
  const parameters: RustCompilerParameter[] = [];
  for (let index = 0; index < rawInputs.length; index += 1) {
    const pair = rawInputs[index];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
      throw new Error(`Rust function '${name}' input ${index} has an invalid rustdoc shape.`);
    }
    const type = normalizeSelectedType(pair[1]);
    if (index === 0 && pair[0] === "self") {
      if (allowReceiver !== true) {
        throw new Error(`Free Rust function '${name}' unexpectedly declares a self receiver.`);
      }
      receiver = receiverKind(type, name);
      continue;
    }
    parameters.push(Object.freeze({ name: pair[0], type }));
  }
  const output = signature.output;
  const result = output === null
    ? Object.freeze({ kind: "unit" as const })
    : normalizeSelectedType(output);
  const borrowed = borrowedResultProjection(document, result, receiver, parameters);
  if (borrowed === undefined && !rustResultTypeHasClosedCarrier(result)) {
    throw new Error(`Rust function '${name}' returns a borrowed or unsized value with no closed target carrier.`);
  }
  const typeRequirements = mergeTypeParameterRequirements(
    inheritedRequirements,
    typeParameters,
    ...(borrowed?.typeRequirements === undefined ? [] : [borrowed.typeRequirements]),
  );
  return Object.freeze({
    id: canonicalItemId(dependency, item),
    name,
    parameters: Object.freeze(parameters),
    result,
    typeParameters,
    typeRequirements,
    ...(receiver === undefined ? {} : { receiver }),
    ...(options.traitDispatch === undefined ? {} : { traitDispatch: options.traitDispatch }),
    ...(borrowed === undefined ? {} : { borrowedResult: borrowed.projection }),
    asynchronous: header.is_async === true,
    unsafe,
    abi,
    variadic,
  });
}

function rustResultTypeHasClosedCarrier(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "reference":
    case "slice":
      return false;
    case "tuple":
      return type.elements.every(rustResultTypeHasClosedCarrier);
    case "array":
      return rustResultTypeHasClosedCarrier(type.element);
    case "raw-pointer":
      return true;
    case "function-pointer":
      return type.parameters.every(rustResultTypeHasClosedCarrier) &&
        rustResultTypeHasClosedCarrier(type.result);
    case "path":
      return type.typeArguments.every(rustResultTypeHasClosedCarrier);
    case "associated-type":
      return false;
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return true;
  }
}

function receiverKind(type: RustCompilerType, functionName: string): RustCompilerFunction["receiver"] {
  if (type.kind === "self") {
    return Object.freeze({ kind: "value" });
  }
  if (type.kind === "reference" && type.target.kind === "self") {
    return Object.freeze({
      kind: type.mutable ? "mutable" : "shared",
      ...(type.lifetime === undefined ? {} : { lifetime: type.lifetime }),
    });
  }
  if (compilerTypeContainsSelf(type)) {
    if (compilerTypeContainsReference(type)) {
      throw new Error(
        `Rust method '${functionName}' has a borrowed custom receiver with no lifetime-bearing source receiver contract.`,
      );
    }
    return Object.freeze({ kind: "custom", type });
  }
  throw new Error(`Rust method '${functionName}' has a custom receiver that does not contain Self.`);
}

function compilerTypeContainsReference(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "reference":
      return true;
    case "tuple":
      return type.elements.some(compilerTypeContainsReference);
    case "array":
    case "slice":
      return compilerTypeContainsReference(type.element);
    case "raw-pointer":
      return compilerTypeContainsReference(type.target);
    case "function-pointer":
      return type.parameters.some(compilerTypeContainsReference) ||
        compilerTypeContainsReference(type.result);
    case "associated-type":
      return compilerTypeContainsReference(type.owner) ||
        type.trait.typeArguments.some(compilerTypeContainsReference);
    case "path":
      return type.typeArguments.some(compilerTypeContainsReference);
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return false;
  }
}

function compilerTypeContainsSelf(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "self":
      return true;
    case "tuple":
      return type.elements.some(compilerTypeContainsSelf);
    case "array":
    case "slice":
      return compilerTypeContainsSelf(type.element);
    case "reference":
    case "raw-pointer":
      return compilerTypeContainsSelf(type.target);
    case "function-pointer":
      return type.parameters.some(compilerTypeContainsSelf) || compilerTypeContainsSelf(type.result);
    case "associated-type":
      return compilerTypeContainsSelf(type.owner) ||
        type.trait.typeArguments.some(compilerTypeContainsSelf);
    case "path":
      return type.typeArguments.some(compilerTypeContainsSelf);
    case "unit":
    case "primitive":
    case "generic":
      return false;
  }
}

function borrowedResultProjection(
  document: RustdocDocument,
  result: RustCompilerType,
  receiver: RustCompilerFunction["receiver"],
  parameters: readonly RustCompilerParameter[],
): {
  readonly projection: NonNullable<RustCompilerFunction["borrowedResult"]>;
  readonly typeRequirements?: readonly RustCompilerTypeParameter[];
} | undefined {
  if (result.kind !== "reference") {
    return undefined;
  }
  if (result.mutable) {
    return undefined;
  }
  const origin = borrowedResultOrigin(result, receiver, parameters);
  if (origin === undefined) {
    return undefined;
  }
  if (result.target.kind === "primitive" && result.target.name === "str" && result.mutable === false) {
    return {
      projection: Object.freeze({
        sourceType: result.target,
        origin,
        conversion: "owned-string",
      }),
    };
  }
  const typeRequirements = compilerTypeRequirementConditions(
    document,
    result.target,
    "copy",
  );
  if (typeRequirements === undefined) {
    return undefined;
  }
  return {
    projection: Object.freeze({
      sourceType: result.target,
      origin,
      conversion: "copy",
    }),
    ...(typeRequirements.length === 0 ? {} : { typeRequirements }),
  };
}

function borrowedResultOrigin(
  result: Extract<RustCompilerType, { readonly kind: "reference" }>,
  receiver: RustCompilerFunction["receiver"],
  parameters: readonly RustCompilerParameter[],
): NonNullable<RustCompilerFunction["borrowedResult"]>["origin"] | undefined {
  if (result.lifetime === "'static") {
    return Object.freeze({ kind: "static" });
  }
  if (receiver?.kind === "shared" || receiver?.kind === "mutable") {
    if (result.lifetime === undefined || result.lifetime === receiver.lifetime) {
      return Object.freeze({ kind: "receiver" });
    }
  }
  const candidates = parameters.flatMap((parameter, index) =>
    parameter.type.kind === "reference" &&
      (result.lifetime === undefined || parameter.type.lifetime === result.lifetime)
      ? [index]
      : []);
  return candidates.length === 1
    ? Object.freeze({ kind: "parameter", index: candidates[0]! })
    : undefined;
}
