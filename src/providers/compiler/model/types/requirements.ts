import {
  compareText,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
  rustdocItemEffectiveStability,
} from "../rustdoc-schema.js";
import { resolveRustdocItem } from "../rustdoc-items.js";
import { rustCompilerTraitIsSourceAvailable } from "../source-availability.js";
import {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  genericParameterMap,
  normalizeGenerics,
  normalizeTraitReference,
  normalizeType,
  type RustCompilerNormalizationContext,
} from "./normalization.js";
import {
  rustCompilerArgumentSemanticKey,
  rustCompilerBoundSemanticKey,
  rustCompilerTraitSemanticKey,
  rustCompilerTypeSemanticKey,
  rustCompilerTypesEqual,
  substituteRustCompilerArgument,
  substituteRustCompilerBound,
  substituteRustCompilerTrait,
  substituteRustCompilerType,
  type RustCompilerSubstitutions,
} from "./substitution.js";
import type {
  RustCompilerBound,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
  RustCompilerTraitImplementation,
  RustCompilerTraitReference,
  RustCompilerType,
  RustCompilerTypeParameter,
  RustCompilerTypeTraits,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";

export function normalizeTypeTraits(
  document: RustdocDocument,
  owner: Readonly<Record<string, unknown>>,
  declaredGenerics: RustCompilerGenerics,
  ownerCanonicalPath: readonly string[],
  context: RustCompilerNormalizationContext,
): RustCompilerTypeTraits {
  const implementations = new Map<string, RustCompilerTraitImplementation>();
  for (const implId of requireArray(owner.impls, "Rust type implementations")) {
    const implItem = itemById(document, implId);
    if (rustdocItemEffectiveStability(document, implItem) === "unstable") continue;
    const impl = requireInnerRecord(implItem, "impl", "Rust type implementation");
    if (!isRecord(impl.trait) || impl.is_negative === true || impl.blanket_impl !== null) continue;
    const traitDeclaration = resolveRustdocItem(
      document,
      context.dependency,
      impl.trait.id,
      context.resolveItem,
    );
    if (rustdocItemEffectiveStability(traitDeclaration.document, traitDeclaration.item) === "unstable") continue;
    const implOwner = {
      itemId: `${context.owner.itemId}::impl:${String(implId)}`,
      canonicalPath: Object.freeze([...context.owner.canonicalPath, `<impl:${String(implId)}>`]),
    };
    const implGenerics = normalizeGenerics(
      document,
      requireRecord(impl.generics, "Rust implementation generics"),
      {
        dependency: context.dependency,
        owner: implOwner,
        ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
      },
    );
    const implContext: RustCompilerNormalizationContext = {
      dependency: context.dependency,
      owner: implOwner,
      parameters: genericParameterMap(implGenerics),
      ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
    };
    const trait = normalizeTraitReference(document, impl.trait, implContext);
    if (!rustCompilerTraitIsSourceAvailable(
      document,
      context.dependency,
      trait,
      context.resolveItem,
    )) continue;
    const genericBindings = directImplementationGenericBindings(
      document,
      impl,
      implGenerics,
      declaredGenerics,
      ownerCanonicalPath,
      implContext,
    );
    if (genericBindings === undefined) continue;
    const substitutions = implementationOwnerGenericSubstitutions(
      genericBindings,
      declaredGenerics,
    );
    if (substitutions === undefined) continue;
    const rawRequirements = conditionalTraitRequirements(implGenerics, genericBindings);
    const requirements = rawRequirements?.map((requirement) => {
      const bound = substituteRustCompilerBound(requirement.bound, substitutions);
      if (bound.kind !== "trait") {
        throw new Error("Rust trait implementation substitution changed a trait requirement's kind.");
      }
      const declared = declaredGenerics.parameters[requirement.genericArgumentIndex];
      const defaultArgumentSatisfiesBound = declared?.kind === "type" &&
        declared.defaultType !== undefined &&
        compilerTypeSupportsTrait(
          document,
          declared.defaultType,
          bound.trait,
          context,
        );
      return Object.freeze({
        ...requirement,
        bound,
        ...(defaultArgumentSatisfiesBound
          ? { defaultArgumentSatisfiesBound: true as const }
          : {}),
      });
    });
    if (requirements === undefined) continue;
    const implementation = Object.freeze({
      trait: substituteRustCompilerTrait(trait, substitutions),
      genericBindings: Object.freeze(genericBindings.map((binding) => Object.freeze({
        ...binding,
        parameter: substituteRustCompilerArgument(binding.parameter, substitutions),
      }))),
      requirements: Object.freeze(requirements),
    });
    implementations.set(traitImplementationKey(implementation), implementation);
  }
  return Object.freeze({
    implementations: Object.freeze([...implementations.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, implementation]) => implementation)),
  });
}

function implementationOwnerGenericSubstitutions(
  bindings: RustCompilerTraitImplementation["genericBindings"],
  declaredGenerics: RustCompilerGenerics,
): RustCompilerSubstitutions | undefined {
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, import("../model.js").RustCompilerLifetime>();
  const consts = new Map<string, import("../model.js").RustCompilerConstExpression>();
  for (const binding of bindings) {
    const sourceIdentity = compilerGenericArgumentParameterIdentity(binding.parameter);
    const declared = declaredGenerics.parameters[binding.genericArgumentIndex];
    const target = declared === undefined
      ? undefined
      : compilerGenericParameterArgument(declared);
    if (sourceIdentity === undefined || target === undefined || target.kind !== binding.parameter.kind) {
      return undefined;
    }
    if (target.kind === "type") types.set(sourceIdentity, target.value);
    else if (target.kind === "lifetime") lifetimes.set(sourceIdentity, target.value);
    else consts.set(sourceIdentity, target.value);
  }
  return Object.freeze({ types, lifetimes, consts });
}

export function directImplementationGenericBindings(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationGenerics: RustCompilerGenerics,
  declaredGenerics: RustCompilerGenerics,
  ownerCanonicalPath: readonly string[],
  context: RustCompilerNormalizationContext,
): RustCompilerTraitImplementation["genericBindings"] | undefined {
  const target = normalizeType(document, impl.for, context);
  if (target.kind !== "path" || canonicalCompilerTypePathKey(target) !== canonicalPathKey(ownerCanonicalPath)) {
    return undefined;
  }
  const declared = declaredGenerics.parameters;
  if (target.arguments.length !== declared.length) return undefined;
  const implementationParameters = new Map(implementationGenerics.parameters.flatMap((parameter) => {
    const identity = compilerGenericParameterIdentity(parameter);
    return identity === undefined ? [] : [[identity, parameter] as const];
  }));
  if (implementationParameters.size !== implementationGenerics.parameters.length) return undefined;
  const selected = new Set<string>();
  const bindings: RustCompilerTraitImplementation["genericBindings"][number][] = [];
  for (let index = 0; index < target.arguments.length; index += 1) {
    const argument = target.arguments[index]!;
    const parameter = declared[index];
    if (parameter === undefined || argument.kind !== parameter.kind) return undefined;
    const identity = compilerGenericArgumentParameterIdentity(argument);
    const implementationParameter = identity === undefined
      ? undefined
      : implementationParameters.get(identity);
    if (implementationParameter === undefined || implementationParameter.kind !== argument.kind ||
      selected.has(identity!)) return undefined;
    const openParameter = compilerGenericParameterArgument(implementationParameter);
    if (openParameter === undefined ||
      rustCompilerArgumentSemanticKey(openParameter) !== rustCompilerArgumentSemanticKey(argument)) return undefined;
    selected.add(identity!);
    bindings.push(Object.freeze({
      parameter: openParameter,
      genericArgumentIndex: index,
    }));
  }
  return selected.size === implementationParameters.size
    ? Object.freeze(bindings)
    : undefined;
}

function conditionalTraitRequirements(
  generics: RustCompilerGenerics,
  bindings: RustCompilerTraitImplementation["genericBindings"],
): readonly RustCompilerTraitImplementation["requirements"][number][] | undefined {
  const positions = new Map(bindings.flatMap((binding) => {
    const identity = compilerGenericArgumentParameterIdentity(binding.parameter);
    return identity === undefined ? [] : [[identity, binding.genericArgumentIndex] as const];
  }));
  if (positions.size !== bindings.length) return undefined;
  const requirements = new Map<string, RustCompilerTraitImplementation["requirements"][number]>();

  const recordBound = (
    parameterIdentity: string,
    bound: RustCompilerBound,
    predicateBinder?: import("../model.js").RustCompilerBinder,
  ): boolean => {
    if (bound.kind !== "trait") return false;
    if (bound.polarity === "maybe") return true;
    if (bound.polarity !== "required" ||
      predicateBinder !== undefined && bound.binder !== undefined) return false;
    const genericArgumentIndex = positions.get(parameterIdentity);
    if (genericArgumentIndex === undefined) return false;
    const effectiveBound = predicateBinder === undefined
      ? bound
      : Object.freeze({ ...bound, binder: predicateBinder });
    const requirement = Object.freeze({ genericArgumentIndex, bound: effectiveBound });
    requirements.set(
      `${String(genericArgumentIndex).padStart(12, "0")}\0${rustCompilerBoundSemanticKey(effectiveBound)}`,
      requirement,
    );
    return true;
  };

  for (const parameter of generics.parameters) {
    const identity = compilerGenericParameterIdentity(parameter);
    if (identity === undefined) return undefined;
    if (parameter.kind === "lifetime") {
      if (parameter.bounds.length !== 0) return undefined;
      continue;
    }
    if (parameter.kind === "const") continue;
    if (!parameter.bounds.every((bound) => recordBound(identity, bound))) return undefined;
  }

  for (const predicate of generics.wherePredicates) {
    if (predicate.kind !== "type" || predicate.type.kind !== "type-parameter") return undefined;
    const identity = predicate.type.identity.itemId;
    if (!predicate.bounds.every((bound) => recordBound(identity, bound, predicate.binder))) {
      return undefined;
    }
  }

  return Object.freeze([...requirements.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, requirement]) => requirement));
}

function compilerGenericParameterIdentity(
  parameter: RustCompilerGenericParameter,
): string | undefined {
  return parameter.kind === "lifetime"
    ? parameter.identity.kind === "parameter"
      ? parameter.identity.identity.itemId
      : undefined
    : parameter.identity.itemId;
}

function compilerGenericArgumentParameterIdentity(
  argument: RustCompilerGenericArgument,
): string | undefined {
  if (argument.kind === "lifetime") {
    return argument.value.kind === "parameter" ? argument.value.identity.itemId : undefined;
  }
  if (argument.kind === "type") {
    return argument.value.kind === "type-parameter" ? argument.value.identity.itemId : undefined;
  }
  return argument.value.kind === "parameter" ? argument.value.identity.itemId : undefined;
}

function compilerGenericParameterArgument(
  parameter: RustCompilerGenericParameter,
): RustCompilerGenericArgument | undefined {
  if (parameter.kind === "lifetime") {
    return parameter.identity.kind === "parameter"
      ? Object.freeze({ kind: "lifetime", value: parameter.identity })
      : undefined;
  }
  if (parameter.kind === "type") {
    return Object.freeze({
      kind: "type",
      value: Object.freeze({
        kind: "type-parameter",
        identity: parameter.identity,
        displayName: parameter.displayName,
      }),
    });
  }
  return Object.freeze({
    kind: "const",
    value: Object.freeze({
      kind: "parameter",
      identity: parameter.identity,
      displayName: parameter.displayName,
    }),
  });
}

export function typeParameterGuaranteesTrait(
  parameter: RustCompilerTypeParameter,
  trait: RustCompilerTraitReference,
): boolean {
  const selected = new Set(parameter.bounds.flatMap((bound) =>
    bound.kind === "trait" && bound.polarity === "required"
      ? [rustCompilerTraitSemanticKey(bound.trait)]
      : []));
  if (selected.has(rustCompilerTraitSemanticKey(trait))) return true;
  return canonicalTraitPath(trait) === "core::clone::Clone" && parameter.bounds.some((bound) =>
    bound.kind === "trait" && bound.polarity === "required" &&
    canonicalTraitPath(bound.trait) === "core::marker::Copy");
}

export function compilerTypeSupportsTrait(
  document: RustdocDocument,
  type: RustCompilerType,
  trait: RustCompilerTraitReference,
  context: RustCompilerNormalizationContext,
  active: Set<string> = new Set(),
): boolean {
  const traitPath = canonicalTraitPath(trait);
  switch (type.kind) {
    case "primitive":
      return primitiveSupportsTrait(type.name, traitPath);
    case "unit": return unitSupportsTrait(traitPath);
    case "never": return neverSupportsTrait(traitPath);
    case "tuple":
      return tupleSupportsTrait(type.elements.length, traitPath) &&
        type.elements.every((element) => compilerTypeSupportsTrait(document, element, trait, context, active));
    case "array":
      return arraySupportsTrait(type.length, traitPath) &&
        compilerTypeSupportsTrait(document, type.element, trait, context, active);
    case "reference": return compilerReferenceSupportsTrait(
      document,
      type,
      trait,
      traitPath,
      context,
      active,
    );
    case "function-pointer": return functionPointerSupportsTrait(traitPath);
    case "raw-pointer": return rawPointerSupportsTrait(traitPath);
    case "slice":
      return sliceSupportsTrait(traitPath) &&
        compilerTypeSupportsTrait(document, type.element, trait, context, active);
    case "trait-object":
      return rustCompilerTraitSemanticKey(type.principal) === rustCompilerTraitSemanticKey(trait) ||
        type.autoTraits.some((candidate) =>
          rustCompilerTraitSemanticKey(candidate) === rustCompilerTraitSemanticKey(trait));
    case "opaque":
      return type.bounds.some((bound) => bound.kind === "trait" &&
        bound.polarity === "required" && bound.binder === undefined &&
        rustCompilerTraitSemanticKey(bound.trait) === rustCompilerTraitSemanticKey(trait));
    case "path":
      return compilerPathTypeSupportsTrait(document, type, trait, context, active);
    case "type-parameter": {
      const parameter = compilerTypeParameterByIdentity(context, type.identity.itemId);
      return parameter?.kind === "type" && typeParameterGuaranteesTrait(parameter, trait);
    }
    case "self":
    case "associated-type":
      return false;
  }
}

export function compilerTypeTraitConditions(
  document: RustdocDocument,
  type: RustCompilerType,
  trait: RustCompilerTraitReference,
  context: RustCompilerNormalizationContext,
): readonly RustCompilerTypeParameter[] | undefined {
  if (type.kind === "type-parameter") {
    const selected = compilerTypeParameterByIdentity(context, type.identity.itemId);
    if (selected?.kind !== "type") return undefined;
    if (typeParameterGuaranteesTrait(selected, trait)) return Object.freeze([]);
    return Object.freeze([Object.freeze({
      ...selected,
      bounds: Object.freeze([...selected.bounds, Object.freeze({
        kind: "trait" as const,
        trait,
        polarity: "required" as const,
      })]),
    })]);
  }
  if (type.kind === "tuple") {
    return mergeTypeParameterConditions(type.elements.map((element) =>
      compilerTypeTraitConditions(document, element, trait, context)));
  }
  if (type.kind === "array") return compilerTypeTraitConditions(document, type.element, trait, context);
  return compilerTypeSupportsTrait(document, type, trait, context)
    ? Object.freeze([])
    : undefined;
}

export function rustCompilerTraitByCanonicalPath(
  document: RustdocDocument,
  context: RustCompilerNormalizationContext,
  canonicalPath: readonly string[],
): RustCompilerTraitReference | undefined {
  const matches = Object.entries(document.paths).filter(([, candidate]) =>
    isRecord(candidate) && candidate.kind === "trait" && Array.isArray(candidate.path) &&
    canonicalPathKey(candidate.path as string[]) === canonicalPathKey(canonicalPath));
  if (matches.length !== 1) return undefined;
  const [id] = matches[0]!;
  return normalizeTraitReference(document, { id, args: null }, context);
}

function compilerPathTypeSupportsTrait(
  document: RustdocDocument,
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
  trait: RustCompilerTraitReference,
  context: RustCompilerNormalizationContext,
  active: Set<string>,
): boolean {
  const activeKey = `${rustCompilerTypeSemanticKey(type)}\0${rustCompilerTraitSemanticKey(trait)}`;
  if (active.has(activeKey)) return false;
  active.add(activeKey);
  try {
    const item = compilerTypeDeclarationItem(document, type);
    const declaration = item === undefined ? undefined : compilerTypeDeclaration(item);
    if (declaration === undefined) return false;
    for (const implId of requireArray(declaration.impls, "Rust concrete type implementations")) {
      const implItem = itemById(document, implId);
      if (rustdocItemEffectiveStability(document, implItem) === "unstable") continue;
      const impl = requireInnerRecord(implItem, "impl", "Rust concrete type implementation");
      if (!isRecord(impl.trait) || impl.is_negative === true || impl.blanket_impl !== null) continue;
      const traitDeclaration = resolveRustdocItem(
        document,
        context.dependency,
        impl.trait.id,
        context.resolveItem,
      );
      if (rustdocItemEffectiveStability(traitDeclaration.document, traitDeclaration.item) === "unstable") continue;
      const owner = {
        itemId: `${context.owner.itemId}::impl:${String(implId)}`,
        canonicalPath: Object.freeze([...context.owner.canonicalPath, `<impl:${String(implId)}>`]),
      };
      const generics = normalizeGenerics(document, requireRecord(impl.generics, "Rust concrete implementation generics"), {
        dependency: context.dependency,
        owner,
        ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
      });
      const implContext = {
        dependency: context.dependency,
        owner,
        parameters: genericParameterMap(generics),
        ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
      };
      const selectedTrait = normalizeTraitReference(document, impl.trait, implContext);
      if (!rustCompilerTraitIsSourceAvailable(
        document,
        context.dependency,
        selectedTrait,
        context.resolveItem,
      )) continue;
      const substitutions = directImplementationSubstitutions(document, impl, type, implContext);
      if (substitutions === undefined) continue;
      if (rustCompilerTraitSemanticKey(substituteRustCompilerTrait(selectedTrait, substitutions)) !==
        rustCompilerTraitSemanticKey(trait)) continue;
      if (compilerImplementationRequirementsSatisfied(
        document,
        generics,
        substitutions,
        implContext,
        active,
      )) return true;
    }
    return false;
  } finally {
    active.delete(activeKey);
  }
}

function compilerImplementationRequirementsSatisfied(
  document: RustdocDocument,
  generics: RustCompilerGenerics,
  substitutions: RustCompilerSubstitutions,
  context: RustCompilerNormalizationContext,
  active: Set<string>,
): boolean {
  const boundSatisfied = (subject: RustCompilerType, bound: RustCompilerBound): boolean => {
    const selected = substituteRustCompilerBound(bound, substitutions);
    if (selected.kind !== "trait") return false;
    if (selected.polarity === "maybe") return true;
    return selected.polarity === "required" && selected.binder === undefined &&
      compilerTypeSupportsTrait(
        document,
        substituteRustCompilerType(subject, substitutions),
        selected.trait,
        context,
        active,
      );
  };

  for (const parameter of generics.parameters) {
    if (parameter.kind === "lifetime") {
      if (parameter.bounds.length !== 0) return false;
      continue;
    }
    if (parameter.kind === "const") continue;
    const subject = substitutions.types.get(parameter.identity.itemId);
    if (subject === undefined || !parameter.bounds.every((bound) => boundSatisfied(subject, bound))) {
      return false;
    }
  }
  return generics.wherePredicates.every((predicate) =>
    predicate.kind === "type" && predicate.binder === undefined &&
    predicate.bounds.every((bound) => boundSatisfied(predicate.type, bound)));
}

function directImplementationSubstitutions(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  actual: Extract<RustCompilerType, { readonly kind: "path" }>,
  context: RustCompilerNormalizationContext,
): RustCompilerSubstitutions | undefined {
  const pattern = normalizeType(document, impl.for, context);
  if (pattern.kind !== "path" || canonicalCompilerTypePathKey(pattern) !== canonicalCompilerTypePathKey(actual) ||
    pattern.arguments.length !== actual.arguments.length) return undefined;
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, import("../model.js").RustCompilerLifetime>();
  const consts = new Map<string, import("../model.js").RustCompilerConstExpression>();
  for (let index = 0; index < pattern.arguments.length; index += 1) {
    const expected = pattern.arguments[index]!;
    const selected = actual.arguments[index]!;
    if (expected.kind !== selected.kind) return undefined;
    if (expected.kind === "type" && selected.kind === "type" && expected.value.kind === "type-parameter") {
      const existing = types.get(expected.value.identity.itemId);
      if (existing !== undefined && !rustCompilerTypesEqual(existing, selected.value)) return undefined;
      types.set(expected.value.identity.itemId, selected.value);
      continue;
    }
    if (expected.kind === "lifetime" && selected.kind === "lifetime" && expected.value.kind === "parameter") {
      const existing = lifetimes.get(expected.value.identity.itemId);
      if (existing !== undefined && rustCompilerArgumentSemanticKey({ kind: "lifetime", value: existing }) !==
        rustCompilerArgumentSemanticKey(selected)) return undefined;
      lifetimes.set(expected.value.identity.itemId, selected.value);
      continue;
    }
    if (expected.kind === "const" && selected.kind === "const" && expected.value.kind === "parameter") {
      const existing = consts.get(expected.value.identity.itemId);
      if (existing !== undefined && rustCompilerArgumentSemanticKey({ kind: "const", value: existing }) !==
        rustCompilerArgumentSemanticKey(selected)) return undefined;
      consts.set(expected.value.identity.itemId, selected.value);
      continue;
    }
    if (rustCompilerArgumentKey(expected) !== rustCompilerArgumentKey(selected)) return undefined;
  }
  return Object.freeze({ types, lifetimes, consts });
}

function compilerTypeDeclarationItem(
  document: RustdocDocument,
  type: Extract<RustCompilerType, { readonly kind: "path" }>,
): Readonly<Record<string, unknown>> | undefined {
  const itemSegments = type.identity.itemId.split("#");
  const candidate = document.index[itemSegments[itemSegments.length - 1] ?? ""];
  return isRecord(candidate) ? candidate : undefined;
}

function compilerTypeParameterByIdentity(
  context: RustCompilerNormalizationContext,
  itemId: string,
): RustCompilerTypeParameter | undefined {
  for (const parameter of context.parameters?.values() ?? []) {
    if (parameter.kind === "type" && parameter.identity.itemId === itemId) return parameter;
  }
  return undefined;
}

function compilerTypeDeclaration(item: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  const inner = isRecord(item.inner) ? item.inner : undefined;
  if (inner === undefined) return undefined;
  for (const kind of ["struct", "enum", "union", "trait"]) {
    if (isRecord(inner[kind])) return inner[kind] as Readonly<Record<string, unknown>>;
  }
  return undefined;
}

function mergeTypeParameterConditions(
  groups: readonly (readonly RustCompilerTypeParameter[] | undefined)[],
): readonly RustCompilerTypeParameter[] | undefined {
  if (groups.some((group) => group === undefined)) return undefined;
  const selected = new Map<string, RustCompilerTypeParameter>();
  for (const group of groups) {
    for (const parameter of group ?? []) {
      const existing = selected.get(parameter.identity.itemId);
      selected.set(parameter.identity.itemId, existing === undefined
        ? parameter
        : Object.freeze({
            ...existing,
            bounds: Object.freeze(uniqueBounds([...existing.bounds, ...parameter.bounds])),
          }));
    }
  }
  return Object.freeze([...selected.values()].sort((left, right) =>
    compareText(left.identity.itemId, right.identity.itemId)));
}

function uniqueBounds(bounds: readonly RustCompilerBound[]): readonly RustCompilerBound[] {
  const selected = new Map<string, RustCompilerBound>();
  for (const bound of bounds) {
    const key = rustCompilerBoundSemanticKey(bound);
    selected.set(key, bound);
  }
  return [...selected.entries()].sort(([left], [right]) => compareText(left, right)).map(([, value]) => value);
}

function canonicalTraitPath(trait: RustCompilerTraitReference): string {
  return trait.identity.canonicalPath.join("::");
}

function primitiveSupportsTrait(name: string, traitPath: string): boolean {
  if (name === "str") {
    return isAutoTraitPath(traitPath) || isEqualityOrderingHashTraitPath(traitPath) ||
      traitPath === "core::fmt::Debug";
  }
  if (isScalarValueTraitPath(traitPath)) return true;
  const ordered = name === "bool" || name === "char" ||
    /^(?:[iu](?:8|16|32|64|128)|isize|usize)$/u.test(name);
  return ordered && (traitPath === "core::cmp::Eq" || traitPath === "core::hash::Hash" ||
    traitPath === "core::cmp::Ord");
}

function unitSupportsTrait(traitPath: string): boolean {
  return isScalarValueTraitPath(traitPath) || isEqualityOrderingHashTraitPath(traitPath);
}

function neverSupportsTrait(traitPath: string): boolean {
  return traitPath !== "core::default::Default" &&
    (isScalarValueTraitPath(traitPath) || isEqualityOrderingHashTraitPath(traitPath));
}

function tupleSupportsTrait(length: number, traitPath: string): boolean {
  return isAutoTraitPath(traitPath) || length <= 12 && (
    isScalarValueTraitPath(traitPath) || isEqualityOrderingHashTraitPath(traitPath)
  );
}

function arraySupportsTrait(
  length: import("../model.js").RustCompilerConstExpression,
  traitPath: string,
): boolean {
  if (traitPath === "core::default::Default") {
    return length.kind === "literal" && length.literalKind === "integer" &&
      length.value >= 0n && length.value <= 32n;
  }
  return isAutoTraitPath(traitPath) || isCopyCloneDebugTraitPath(traitPath) ||
    isEqualityOrderingHashTraitPath(traitPath);
}

function sliceSupportsTrait(traitPath: string): boolean {
  return isAutoTraitPath(traitPath) || traitPath === "core::fmt::Debug" ||
    isEqualityOrderingHashTraitPath(traitPath);
}

function compilerReferenceSupportsTrait(
  document: RustdocDocument,
  type: Extract<RustCompilerType, { readonly kind: "reference" }>,
  trait: RustCompilerTraitReference,
  traitPath: string,
  context: RustCompilerNormalizationContext,
  active: Set<string>,
): boolean {
  if (traitPath === "core::marker::Unpin") return true;
  if (traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone") {
    return !type.mutable;
  }
  if (traitPath === "core::marker::Send") {
    const required = type.mutable
      ? rustCompilerTraitByCanonicalPath(document, context, ["core", "marker", "Send"])
      : rustCompilerTraitByCanonicalPath(document, context, ["core", "marker", "Sync"]);
    return required !== undefined && compilerTypeSupportsTrait(document, type.target, required, context, active);
  }
  if (traitPath === "core::marker::Sync") {
    const required = rustCompilerTraitByCanonicalPath(document, context, ["core", "marker", "Sync"]);
    return required !== undefined && compilerTypeSupportsTrait(document, type.target, required, context, active);
  }
  return (traitPath === "core::fmt::Debug" || isEqualityOrderingHashTraitPath(traitPath)) &&
    compilerTypeSupportsTrait(document, type.target, trait, context, active);
}

function functionPointerSupportsTrait(traitPath: string): boolean {
  return isCopyCloneTraitPath(traitPath) || isAutoTraitPath(traitPath) ||
    traitPath === "core::fmt::Debug" || isEqualityOrderingHashTraitPath(traitPath);
}

function rawPointerSupportsTrait(traitPath: string): boolean {
  return isCopyCloneTraitPath(traitPath) || traitPath === "core::marker::Unpin" ||
    traitPath === "core::fmt::Debug" || isEqualityOrderingHashTraitPath(traitPath);
}

function isScalarValueTraitPath(traitPath: string): boolean {
  return isCopyCloneDebugTraitPath(traitPath) || traitPath === "core::default::Default" ||
    traitPath === "core::cmp::PartialEq" || traitPath === "core::cmp::PartialOrd" ||
    isAutoTraitPath(traitPath);
}

function isCopyCloneDebugTraitPath(traitPath: string): boolean {
  return isCopyCloneTraitPath(traitPath) || traitPath === "core::fmt::Debug";
}

function isCopyCloneTraitPath(traitPath: string): boolean {
  return traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone";
}

function isEqualityOrderingHashTraitPath(traitPath: string): boolean {
  return traitPath === "core::cmp::PartialEq" || traitPath === "core::cmp::Eq" ||
    traitPath === "core::hash::Hash" || traitPath === "core::cmp::PartialOrd" ||
    traitPath === "core::cmp::Ord";
}

function isAutoTraitPath(traitPath: string): boolean {
  return traitPath === "core::marker::Send" || traitPath === "core::marker::Sync" ||
    traitPath === "core::marker::Unpin";
}

function traitImplementationKey(implementation: RustCompilerTraitImplementation): string {
  return [
    rustCompilerTraitSemanticKey(implementation.trait),
    ...implementation.genericBindings.map((binding) =>
      `${binding.genericArgumentIndex}:${rustCompilerArgumentSemanticKey(binding.parameter)}`),
    ...implementation.requirements.map((requirement) =>
      `${requirement.genericArgumentIndex}:${rustCompilerBoundSemanticKey(requirement.bound)}:${requirement.defaultArgumentSatisfiesBound === true ? "default-proven" : "default-unproven"}`),
  ].join("\0");
}

function rustCompilerArgumentKey(argument: import("../model.js").RustCompilerGenericArgument): string {
  return rustCompilerArgumentSemanticKey(argument);
}
