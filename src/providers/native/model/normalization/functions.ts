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
  rustCompilerTypeSemanticKey,
  substituteRustCompilerArgument,
  substituteRustCompilerType,
} from "../rustdoc-types.js";
import {
  normalizeAbi,
  requireArray,
  requireBoolean,
  requireInnerRecord,
  requireRecord,
  requireString,
} from "../rustdoc-schema.js";
import { normalizeMemberType, substituteMemberParameter } from "./associated-types.js";
import type {
  RustCompilerDependency,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerItemIdentity,
  RustCompilerLifetime,
  RustCompilerParameter,
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerTypeParameter,
} from "../model.js";
import type { RustdocItemResolver } from "../rustdoc-items.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerSubstitutions } from "../rustdoc-types.js";
import type { RustNativeResultLoanContract, RustNativeResultLoanOrigin } from "../../../../target-model/operations/result-loans.js";

export interface NormalizeRustCompilerFunctionOptions {
  readonly inheritedGenericParameters?: readonly RustCompilerGenericParameter[];
  readonly inheritedRequirements?: readonly RustCompilerTypeParameter[];
  readonly implementationBindings?: RustCompilerSubstitutions;
  readonly associatedTypeBindings?: ReadonlyMap<string, RustCompilerType>;
  readonly traitDispatch?: RustCompilerTraitDispatch;
  readonly selfOwner?: RustCompilerItemIdentity;
  readonly selfType?: RustCompilerType;
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
    { retainContextualTypeRequirements: true },
  );
  const implementationBindings = options.implementationBindings ?? emptyRustCompilerSubstitutions;
  const associatedTypeBindings = options.associatedTypeBindings ?? new Map<string, RustCompilerType>();
  const selfBindings: RustCompilerSubstitutions = Object.freeze({
    types: new Map(options.selfType === undefined || options.selfOwner === undefined
      ? [] : [[options.selfOwner.itemId, options.selfType]]), lifetimes: new Map(), consts: new Map(),
  });
  const normalizeDeclaredType = (raw: unknown, position: string): RustCompilerType => normalizeMemberType(
    document,
    raw,
    Object.freeze({ ...generics.context, position: `${generics.context.position}/${position}` }),
    implementationBindings,
    associatedTypeBindings,
    options.traitDispatch,
  );
  const normalizeSelectedType = (raw: unknown, position: string): RustCompilerType =>
    substituteRustCompilerType(normalizeDeclaredType(raw, position), selfBindings);
  const rawInputs = requireArray(signature.inputs, `${name}.inputs`);
  let receiver: RustCompilerFunction["receiver"];
  const parameters: RustCompilerParameter[] = [];
  for (let index = 0; index < rawInputs.length; index += 1) {
    const pair = rawInputs[index];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
      throw new Error(`Rust function '${name}' input ${index} has an invalid rustdoc shape.`);
    }
    const declaredType = normalizeDeclaredType(pair[1], `parameter:${index}`);
    const type = substituteRustCompilerType(declaredType, selfBindings);
    if (index === 0 && pair[0] === "self") {
      if (allowReceiver !== true) {
        throw new Error(`Free Rust function '${name}' unexpectedly declares a self receiver.`);
      }
      receiver = receiverKind(declaredType, type, name);
      continue;
    }
    parameters.push(Object.freeze({ name: pair[0], type }));
  }
  const result = signature.output === null
    ? Object.freeze({ kind: "unit" as const })
    : normalizeSelectedType(signature.output, "result");
  const selectedGenerics = generics.parameters.map(parameter => parameter.kind !== "type" ? parameter
    : substituteMemberParameter(parameter, implementationBindings, associatedTypeBindings, options.traitDispatch));
  const selectedResultLoans = selectRustCompilerResultLoans({ identity, result, parameters,
    ...(receiver === undefined ? {} : { receiver }),
    genericParameters: [...inherited, ...selectedGenerics].map(parameter => {
      if (parameter.kind !== "lifetime") return parameter;
      const lifetime = substituteRustCompilerArgument({ kind: "lifetime", lifetime: parameter.lifetime }, implementationBindings);
      const outlives = parameter.outlives.map(selected => {
        const value = substituteRustCompilerArgument({ kind: "lifetime", lifetime: selected }, implementationBindings);
        if (value.kind !== "lifetime") throw new Error("A native lifetime substitution changed its declared argument kind.");
        return value.lifetime;
      });
      if (lifetime.kind !== "lifetime") throw new Error("A native lifetime substitution changed its declared argument kind.");
      return lifetime.lifetime.kind === "parameter" || lifetime.lifetime.kind === "bound"
        ? Object.freeze({ ...parameter, lifetime: lifetime.lifetime, outlives: Object.freeze(outlives) }) : parameter;
    }),
  });
  const resultLoans = selectedResultLoans.contract;
  const borrowed = borrowedResultProjection(document, dependency, result, resultLoans, options.resolveItem);
  if (borrowed === undefined && !rustResultTypeHasClosedCarrier(result)) {
    throw new Error(`Rust function '${name}' returns an unsized value with no closed target carrier.`);
  }
  const ownTypeParameters = selectedGenerics.filter((parameter): parameter is RustCompilerTypeParameter =>
    parameter.kind === "type");
  const typeRequirements = mergeTypeParameterRequirements([
    ...(options.inheritedRequirements ?? []),
    ...generics.contextualTypeRequirements,
    ...ownTypeParameters,
    ...(borrowed?.typeRequirements ?? []),
  ].map(parameter => substituteMemberParameter(parameter, implementationBindings, associatedTypeBindings,
    options.traitDispatch)));
  return Object.freeze({
    identity,
    name,
    parameters: Object.freeze(parameters),
    result,
    genericParameters: Object.freeze(selectedGenerics),
    typeRequirements,
    resultLoans,
    resultLoanTypes: selectedResultLoans.types,
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

function receiverKind(declared: RustCompilerType, type: RustCompilerType, functionName: string): RustCompilerFunction["receiver"] {
  if (declared.kind === "self") return Object.freeze({ kind: "value", type });
  if (declared.kind === "reference" && declared.target.kind === "self") {
    return Object.freeze({
      kind: declared.mutable ? "mutable" : "shared",
      lifetime: declared.lifetime,
      type,
    });
  }
  if (compilerTypeContainsSelf(declared)) {
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
  resultLoans: RustNativeResultLoanContract,
  resolveItem?: RustdocItemResolver,
): {
  readonly projection: NonNullable<RustCompilerFunction["borrowedResult"]>;
  readonly typeRequirements?: readonly RustCompilerTypeParameter[];
} | undefined {
  const selected = borrowedResultReference(result);
  if (selected === undefined || selected.reference.mutable) return undefined;
  const resultPath = selected.optional ? ["argument:0", "reference"] : ["reference"];
  if (selected.reference.lifetime.kind !== "static" && !resultLoans.loans.some(loan =>
    loan.resultPath.length === resultPath.length && loan.resultPath.every((value, index) => value === resultPath[index]))) return undefined;
  if (selected.reference.target.kind === "primitive" &&
      selected.reference.target.name === "str") {
    return {
      projection: Object.freeze({
        sourceType: selected.sourceType,
        conversion: selected.optional ? "optional-owned-string" : "owned-string",
      }),
    };
  }
  const typeRequirements = compilerTypeRequirementConditions(
    document,
    dependency,
    selected.reference.target,
    "copy",
    new Set(),
    resolveItem,
  );
  if (typeRequirements === undefined) return undefined;
  return {
    projection: Object.freeze({
      sourceType: selected.sourceType,
      conversion: selected.optional ? "optional-copy" : "copy",
    }),
    ...(typeRequirements.length === 0 ? {} : { typeRequirements }),
  };
}

function borrowedResultReference(
  result: RustCompilerType,
): {
  readonly reference: Extract<RustCompilerType, { readonly kind: "reference" }>;
  readonly sourceType: RustCompilerType;
  readonly optional: boolean;
} | undefined {
  if (result.kind === "reference") {
    return Object.freeze({
      reference: result,
      sourceType: result.target,
      optional: false,
    });
  }
  if (!isCoreOption(result)) return undefined;
  const argument = result.genericArguments[0];
  if (argument?.kind !== "type" || argument.type.kind !== "reference") {
    return undefined;
  }
  return Object.freeze({
    reference: argument.type,
    sourceType: Object.freeze({
      ...result,
      genericArguments: Object.freeze([
        Object.freeze({
          kind: "type" as const,
          type: argument.type.target,
        }),
      ]),
    }),
    optional: true,
  });
}

function isCoreOption(
  type: RustCompilerType,
): type is Extract<RustCompilerType, { readonly kind: "path" }> {
  return type.kind === "path" &&
    type.identity.canonicalPath.length === 3 &&
    type.identity.canonicalPath[0] === "core" &&
    type.identity.canonicalPath[1] === "option" &&
    type.identity.canonicalPath[2] === "Option" &&
    type.genericArguments.length === 1;
}

interface RustCompilerLifetimeSlot {
  readonly lifetime: RustCompilerLifetime;
  readonly path: readonly string[];
  readonly kind: "borrow" | "carried";
  readonly mutable: boolean;
}

export function selectRustCompilerResultLoans(
  fn: Pick<RustCompilerFunction, "identity" | "result" | "receiver" | "parameters" | "genericParameters">,
): { readonly contract: RustNativeResultLoanContract; readonly types: RustCompilerFunction["resultLoanTypes"] } {
  const reasons = new Set<string>();
  const resultSlots = compilerLifetimeSlots(fn.result, true, reasons).slots;
  const inputs: RustCompilerFunction["resultLoanTypes"]["inputs"][number][] = [];
  const identity = { declarationIdentity: fn.identity.itemId,
    resultTypeIdentity: rustCompilerTypeSemanticKey(fn.result), valueTypeIdentity: rustCompilerTypeSemanticKey(fn.result) };
  const origins: RustNativeResultLoanOrigin[] = [];
  const inputReasons = new Set<string>();
  const lifetimes = new Map<string, RustCompilerLifetime>();
  const anonymousLifetimes = new Map<string, RustCompilerLifetime>();
  const lifetimeKey = (lifetime: RustCompilerLifetime, inputPath: readonly string[]): string =>
    lifetime.kind === "placeholder" ? `anonymous:${fn.identity.itemId.length}:${fn.identity.itemId}:${JSON.stringify(inputPath)}`
      : rustCompilerLifetimeSemanticKey(lifetime);
  const collect = (type: RustCompilerType, input: RustNativeResultLoanOrigin["input"]): void => {
    const selected = compilerLifetimeSlots(type, false, inputReasons, slot => {
      const inputPath = [input.kind, ...input.kind === "argument" ? [String(input.sourceIndex)] : [], ...slot.path];
      const key = lifetimeKey(slot.lifetime, inputPath);
      const lifetime = slot.lifetime.kind === "placeholder" ? Object.freeze({ kind: "elided" as const,
        ownerIdentity: fn.identity.itemId, position: JSON.stringify(inputPath) }) : slot.lifetime;
      lifetimes.set(key, lifetime);
      if (slot.lifetime.kind === "static") return lifetime;
      origins.push(Object.freeze({
      kind: slot.kind, input, inputType: rustCompilerTypeSemanticKey(type), inputPath: slot.path,
      lifetime: key,
      mutable: slot.mutable,
      }));
      return lifetime;
    });
    inputs.push(Object.freeze({ input, type: selected.type }));
  };
  const receiver = fn.receiver;
  if (receiver !== undefined) collect(receiver.type, receiver.kind === "custom"
    ? Object.freeze({ kind: "argument", sourceIndex: 0 }) : Object.freeze({ kind: "receiver" }));
  const elidedReceiver = receiver?.kind === "shared" || receiver?.kind === "mutable"
    ? origins.find(origin => origin.input.kind === "receiver" && origin.inputPath.length === 1 && origin.inputPath[0] === "reference")
    : undefined;
  for (const [index, parameter] of fn.parameters.entries()) collect(parameter.type,
    Object.freeze({ kind: "argument", sourceIndex: index + (receiver?.kind === "custom" ? 1 : 0) }));
  const bounds = new Map<string, readonly string[]>();
  for (const parameter of fn.genericParameters) if (parameter.kind === "lifetime") {
    const key = rustCompilerLifetimeSemanticKey(parameter.lifetime);
    bounds.set(key, [...bounds.get(key) ?? [], ...parameter.outlives.map(rustCompilerLifetimeSemanticKey)]);
  }
  const outlives = (source: string, target: string): boolean => {
    const pending = [source];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === target || current === rustCompilerLifetimeSemanticKey({ kind: "static" })) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...bounds.get(current) ?? []);
    }
    return false;
  };
  const uniqueInputLifetimes = new Set(origins.map(origin => origin.lifetime));
  const loans = [];
  for (const slot of resultSlots) {
    if (slot.lifetime.kind === "static") continue;
    const anonymous = slot.lifetime.kind === "elided" || slot.lifetime.kind === "placeholder";
    const selectedLifetime = anonymous ? elidedReceiver?.lifetime ??
      (uniqueInputLifetimes.size === 1 ? uniqueInputLifetimes.values().next().value : undefined)
      : rustCompilerLifetimeSemanticKey(slot.lifetime);
    if (selectedLifetime === undefined || slot.lifetime.kind === "bound") {
      reasons.add("The declared returned lifetime has no unique enclosing input elision or escaping binder correspondence.");
      continue;
    }
    const selected = origins.filter(origin => outlives(origin.lifetime, selectedLifetime));
    if (selected.length === 0) {
      reasons.add("The declared returned lifetime has no established source-input provenance.");
      continue;
    }
    const actualLifetime = lifetimes.get(selectedLifetime) ?? slot.lifetime;
    lifetimes.set(selectedLifetime, actualLifetime);
    if (anonymous) anonymousLifetimes.set(rustCompilerLifetimeSemanticKey(slot.lifetime), actualLifetime);
    loans.push(Object.freeze({ resultPath: slot.path, lifetime: selectedLifetime, origins: Object.freeze(selected) }));
  }
  const inputLoans: RustNativeResultLoanContract["inputLoans"] = inputReasons.size === 0
    ? Object.freeze({ kind: "complete", origins: Object.freeze(origins) })
    : Object.freeze({ kind: "unavailable", origins: Object.freeze(origins), reasons: Object.freeze([...inputReasons]) });
  const common = { ...identity, loans: Object.freeze(loans), inputLoans };
  const contract: RustNativeResultLoanContract = reasons.size === 0 ? Object.freeze({ ...common, kind: "complete" })
    : Object.freeze({ ...common, kind: "unavailable", reasons: Object.freeze([...reasons]) });
  const result = anonymousLifetimes.size === 0 ? fn.result : substituteRustCompilerType(fn.result,
    { ...emptyRustCompilerSubstitutions, anonymousLifetimes });
  return Object.freeze({ contract, types: Object.freeze({ result,
    lifetimes: Object.freeze([...lifetimes].map(([key, lifetime]) => Object.freeze({ key, lifetime }))),
    inputs: Object.freeze(inputs) }) });
}

function compilerLifetimeSlots(type: RustCompilerType, result: boolean, reasons: Set<string>,
  select: ((slot: RustCompilerLifetimeSlot) => RustCompilerLifetime) | undefined = undefined):
  { readonly slots: readonly RustCompilerLifetimeSlot[]; readonly type: RustCompilerType } {
  const slots: RustCompilerLifetimeSlot[] = [];
  const add = (lifetime: RustCompilerLifetime, path: readonly string[], kind: RustCompilerLifetimeSlot["kind"], mutable = false): RustCompilerLifetime => {
    const slot = Object.freeze({ lifetime, path: Object.freeze([...path]), kind, mutable });
    slots.push(slot);
    return select === undefined ? lifetime : select(slot);
  };
  const argument = (value: RustCompilerGenericArgument, path: readonly string[]): RustCompilerGenericArgument => {
    if (value.kind === "lifetime") return Object.freeze({ kind: "lifetime", lifetime: add(value.lifetime, path, "carried") });
    if (value.kind === "type") return Object.freeze({ kind: "type", type: visit(value.type, path) });
    return value;
  };
  const visit = (value: RustCompilerType, path: readonly string[]): RustCompilerType => {
    switch (value.kind) {
      case "unit":
      case "primitive":
      case "raw-pointer":
      case "function-pointer": return value;
      case "generic":
      case "self":
        reasons.add(result ? "A declared generic or Self result requires its actual instantiated lifetime correspondence."
          : "A declared generic or Self input requires its actual instantiated lifetime correspondence.");
        return value;
      case "reference":
        return Object.freeze({ ...value,
          lifetime: add(value.lifetime, [...path, "reference"], path.length === 0 ? "borrow" : "carried", value.mutable),
          target: visit(value.target, [...path, "referent"]) });
      case "tuple": return Object.freeze({ ...value, elements: Object.freeze(value.elements.map((element, index) =>
        visit(element, [...path, `element:${index}`]))) });
      case "array":
      case "slice": return Object.freeze({ ...value, element: visit(value.element, [...path, "element"]) });
      case "path": return Object.freeze({ ...value, genericArguments: Object.freeze(value.genericArguments.map((value, index) =>
        argument(value, [...path, `argument:${index}`]))) });
      case "associated-type":
        reasons.add(result ? "An associated returned type requires its actual normalized selected type before loan projection."
          : "An associated input type requires its actual normalized selected type before loan projection.");
        return Object.freeze({ ...value, genericArguments: Object.freeze(value.genericArguments.map((value, index) =>
          argument(value, [...path, `argument:${index}`]))) });
      case "trait-object":
        return Object.freeze({ ...value, lifetime: add(value.lifetime, [...path, "object"], "carried"),
          principal: Object.freeze({ ...value.principal, genericArguments: Object.freeze(value.principal.genericArguments.map((value, index) =>
            argument(value, [...path, `trait-argument:${index}`]))) }) });
      case "opaque":
        reasons.add(result ? "An opaque returned type requires its actual selected capture/outlives correspondence."
          : "An opaque input type requires its actual selected capture/outlives correspondence.");
        return Object.freeze({ ...value, captures: Object.freeze(value.captures.map((value, index) => argument(value, [...path, `capture:${index}`]))),
          outlives: Object.freeze(value.outlives.map((lifetime, index) => add(lifetime, [...path, `outlives:${index}`], "carried"))) });
    }
  };
  const selected = visit(type, []);
  return Object.freeze({ slots: Object.freeze(slots), type: selected });
}
