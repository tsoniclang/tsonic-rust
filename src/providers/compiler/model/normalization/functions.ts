import {
  compilerTypeRequirementConditions,
  contextWithParameters,
  emptyRustCompilerSubstitutions,
  mergeTypeParameterRequirements,
  normalizeGenericParameters,
  rootNormalizationContext,
  rootNormalizationContextForIdentity,
  rustCompilerItemIdentity,
  rustCompilerLifetimeSemanticKey,
} from "../rustdoc-types.js";
import {
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import { normalizeMemberType } from "./associated-types.js";
import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
  RustCompilerParameter,
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerTypeParameter,
} from "../model.js";
import type { RustdocItemResolver } from "../rustdoc-items.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerSubstitutions } from "../rustdoc-types.js";

export interface NormalizeRustCompilerFunctionOptions {
  readonly inheritedGenericParameters?: readonly RustCompilerGenericParameter[];
  readonly inheritedRequirements?: readonly RustCompilerTypeParameter[];
  readonly implementationBindings?: RustCompilerSubstitutions;
  readonly associatedTypeBindings?: ReadonlyMap<string, RustCompilerType>;
  readonly traitDispatch?: RustCompilerTraitDispatch;
  readonly selfOwner?: RustCompilerItemIdentity;
  readonly declarationIdentity?: RustCompilerItemIdentity;
  readonly resolveItem?: RustdocItemResolver;
}

export function normalizeFunction(
  document: RustdocDocument,
  item: Readonly<Record<string, unknown>>,
  dependency: RustCompilerDependency,
  allowReceiver: true | undefined,
  options: NormalizeRustCompilerFunctionOptions = {},
): RustCompilerFunction {
  const name = requireString(item.name, "Rust function name");
  const fn = requireInnerRecord(item, "function", `Rust function '${name}'`);
  const signature = requireRecord(fn.sig, `${name}.sig`);
  const header = requireRecord(fn.header, `${name}.header`);
  const identity = options.declarationIdentity ?? rustCompilerItemIdentity(document, dependency, item);
  const root = options.declarationIdentity === undefined
    ? rootNormalizationContext(document, dependency, item, options.resolveItem)
    : rootNormalizationContextForIdentity(dependency, identity, options.resolveItem);
  const inherited = options.inheritedGenericParameters ?? Object.freeze([]);
  const declarationContext = Object.freeze({
    ...contextWithParameters(root, inherited),
    selfOwner: options.selfOwner ?? root.selfOwner,
  });
  const generics = normalizeGenericParameters(
    document,
    requireRecord(fn.generics, `${name}.generics`),
    declarationContext,
  );
  const implementationBindings = options.implementationBindings ?? emptyRustCompilerSubstitutions;
  const associatedTypeBindings = options.associatedTypeBindings ?? new Map<string, RustCompilerType>();
  const normalizeSelectedType = (raw: unknown, position: string): RustCompilerType => normalizeMemberType(
    document,
    raw,
    Object.freeze({ ...generics.context, position: `${generics.context.position}/${position}` }),
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
    const type = normalizeSelectedType(pair[1], `parameter:${index}`);
    if (index === 0 && pair[0] === "self") {
      if (allowReceiver !== true) {
        throw new Error(`Free Rust function '${name}' unexpectedly declares a self receiver.`);
      }
      receiver = receiverKind(type, name);
      continue;
    }
    parameters.push(Object.freeze({ name: pair[0], type }));
  }
  const result = signature.output === null
    ? Object.freeze({ kind: "unit" as const })
    : normalizeSelectedType(signature.output, "result");
  const borrowed = borrowedResultProjection(
    document,
    dependency,
    result,
    receiver,
    parameters,
    options.resolveItem,
  );
  if (borrowed === undefined && !rustResultTypeHasClosedCarrier(result)) {
    throw new Error(`Rust function '${name}' returns an unsized value with no closed target carrier.`);
  }
  const ownTypeParameters = generics.parameters.filter((parameter): parameter is RustCompilerTypeParameter =>
    parameter.kind === "type");
  const typeRequirements = mergeTypeParameterRequirements(
    options.inheritedRequirements ?? Object.freeze([]),
    ownTypeParameters,
    ...(borrowed?.typeRequirements === undefined ? [] : [borrowed.typeRequirements]),
  );
  return Object.freeze({
    identity,
    name,
    parameters: Object.freeze(parameters),
    result,
    genericParameters: generics.parameters,
    typeRequirements,
    ...(receiver === undefined ? {} : { receiver }),
    ...(options.traitDispatch === undefined ? {} : { traitDispatch: options.traitDispatch }),
    ...(borrowed === undefined ? {} : { borrowedResult: borrowed.projection }),
    asynchronous: requireBoolean(header.is_async, `${name}.header.is_async`),
    unsafe: requireBoolean(header.is_unsafe, `${name}.header.is_unsafe`),
    abi: normalizeAbi(header.abi, `${name}.header.abi`),
    variadic: requireBoolean(signature.is_c_variadic, `${name}.sig.is_c_variadic`),
  });
}

function rustResultTypeHasClosedCarrier(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "slice":
      return false;
    case "tuple":
      return type.elements.every(rustResultTypeHasClosedCarrier);
    case "array":
      return rustResultTypeHasClosedCarrier(type.element);
    case "reference":
    case "raw-pointer":
      return true;
    case "function-pointer":
      return type.parameters.every(rustResultTypeHasClosedCarrier) &&
        rustResultTypeHasClosedCarrier(type.result);
    case "trait-object":
    case "opaque":
      return true;
    case "path":
      return type.genericArguments.every(genericArgumentHasClosedCarrier);
    case "associated-type":
      return !type.maybeSized;
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return true;
  }
}

function genericArgumentHasClosedCarrier(argument: RustCompilerGenericArgument): boolean {
  return argument.kind !== "type" || rustResultTypeHasClosedCarrier(argument.type);
}

function receiverKind(type: RustCompilerType, functionName: string): RustCompilerFunction["receiver"] {
  if (type.kind === "self") return Object.freeze({ kind: "value" });
  if (type.kind === "reference" && type.target.kind === "self") {
    return Object.freeze({
      kind: type.mutable ? "mutable" : "shared",
      lifetime: type.lifetime,
    });
  }
  if (compilerTypeContainsSelf(type)) {
    return Object.freeze({ kind: "custom", type });
  }
  throw new Error(`Rust method '${functionName}' has a custom receiver that does not contain Self.`);
}

function compilerTypeContainsSelf(type: RustCompilerType): boolean {
  return visitCompilerType(type, (selected) => selected.kind === "self");
}

function visitCompilerType(
  type: RustCompilerType,
  predicate: (type: RustCompilerType) => boolean,
): boolean {
  if (predicate(type)) return true;
  switch (type.kind) {
    case "unit":
    case "primitive":
    case "generic":
    case "self":
      return false;
    case "tuple":
      return type.elements.some((element) => visitCompilerType(element, predicate));
    case "array":
    case "slice":
      return visitCompilerType(type.element, predicate);
    case "reference":
    case "raw-pointer":
      return visitCompilerType(type.target, predicate);
    case "function-pointer":
      return type.parameters.some((parameter) => visitCompilerType(parameter, predicate)) ||
        visitCompilerType(type.result, predicate);
    case "trait-object":
      return visitTrait(type.principal, predicate) ||
        type.autoTraits.some((trait) => visitTrait(trait, predicate));
    case "opaque":
      return type.bounds.some((trait) => visitTrait(trait, predicate)) ||
        type.captures.some((argument) => visitArgument(argument, predicate));
    case "associated-type":
      return visitCompilerType(type.owner, predicate) || visitTrait(type.trait, predicate) ||
        type.genericArguments.some((argument) => visitArgument(argument, predicate));
    case "path":
      return type.genericArguments.some((argument) => visitArgument(argument, predicate));
  }
}

function visitArgument(
  argument: RustCompilerGenericArgument,
  predicate: (type: RustCompilerType) => boolean,
): boolean {
  return argument.kind === "type" && visitCompilerType(argument.type, predicate);
}

function visitTrait(
  trait: RustCompilerTraitDispatch,
  predicate: (type: RustCompilerType) => boolean,
): boolean {
  return trait.genericArguments.some((argument) => visitArgument(argument, predicate)) ||
    trait.associatedConstraints.some((constraint) => constraint.kind === "equality"
      ? visitCompilerType(constraint.type, predicate)
      : constraint.traits.some((selected) => visitTrait(selected, predicate)));
}

function borrowedResultProjection(
  document: RustdocDocument,
  dependency: RustCompilerDependency,
  result: RustCompilerType,
  receiver: RustCompilerFunction["receiver"],
  parameters: readonly RustCompilerParameter[],
  resolveItem?: RustdocItemResolver,
): {
  readonly projection: NonNullable<RustCompilerFunction["borrowedResult"]>;
  readonly typeRequirements?: readonly RustCompilerTypeParameter[];
} | undefined {
  if (result.kind !== "reference" || result.mutable) return undefined;
  const origin = borrowedResultOrigin(result, receiver, parameters);
  if (origin === undefined) return undefined;
  if (result.target.kind === "primitive" && result.target.name === "str") {
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
    dependency,
    result.target,
    "copy",
    new Set(),
    resolveItem,
  );
  if (typeRequirements === undefined) return undefined;
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
  if (result.lifetime.kind === "static") return Object.freeze({ kind: "static" });
  if (receiver?.kind === "shared" || receiver?.kind === "mutable") {
    if (result.lifetime.kind === "elided" || lifetimesEqual(result.lifetime, receiver.lifetime)) {
      return Object.freeze({ kind: "receiver" });
    }
  }
  const candidates = parameters.flatMap((parameter, index) =>
    parameter.type.kind === "reference" &&
      (result.lifetime.kind === "elided" || lifetimesEqual(result.lifetime, parameter.type.lifetime))
      ? [index]
      : []);
  return candidates.length === 1
    ? Object.freeze({ kind: "parameter", index: candidates[0]! })
    : undefined;
}

function lifetimesEqual(
  left: import("../model.js").RustCompilerLifetime,
  right: import("../model.js").RustCompilerLifetime,
): boolean {
  return rustCompilerLifetimeSemanticKey(left) === rustCompilerLifetimeSemanticKey(right);
}
