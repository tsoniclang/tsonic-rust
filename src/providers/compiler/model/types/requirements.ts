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
  sourceVisibleTypeParameters,
  type RustCompilerNormalizationContext,
} from "./normalization.js";
import {
  rustCompilerArgumentSemanticKey,
  rustCompilerBoundSemanticKey,
  rustCompilerTraitSemanticKey,
  rustCompilerTypeSemanticKey,
  rustCompilerTypesEqual,
  type RustCompilerSubstitutions,
} from "./substitution.js";
import type {
  RustCompilerBound,
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
  const sourceParameters = sourceVisibleTypeParameters(declaredGenerics.parameters);
  for (const implId of requireArray(owner.impls, "Rust type implementations")) {
    const implItem = itemById(document, implId);
    if (rustdocItemEffectiveStability(document, implItem) === "unstable") continue;
    const impl = requireInnerRecord(implItem, "impl", "Rust type implementation");
    if (!isRecord(impl.trait) || impl.is_negative === true || impl.blanket_impl !== null) continue;
    try {
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
      const positions = directImplementationTypeParameterPositions(
        document,
        impl,
        implGenerics,
        declaredGenerics,
        ownerCanonicalPath,
        implContext,
      );
      if (positions === undefined) continue;
      const requirements = implGenerics.parameters.flatMap((parameter) => {
        if (parameter.kind !== "type") return [];
        const typeArgumentIndex = positions.get(parameter.identity.itemId);
        if (typeArgumentIndex === undefined) return parameter.bounds.length === 0 ? [] : [undefined];
        const declared = sourceParameters[typeArgumentIndex];
        if (declared === undefined) return [undefined];
        return parameter.bounds.flatMap((bound) => {
          if (bound.kind !== "trait" || typeParameterGuaranteesTrait(declared, bound.trait)) return [];
          return [{ typeArgumentIndex, trait: bound.trait }];
        });
      });
      if (requirements.some((requirement) => requirement === undefined)) continue;
      const implementation = Object.freeze({
        trait,
        requirements: Object.freeze(requirements as RustCompilerTraitImplementation["requirements"]),
      });
      implementations.set(traitImplementationKey(implementation), implementation);
    } catch {
      continue;
    }
  }
  return Object.freeze({
    implementations: Object.freeze([...implementations.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, implementation]) => implementation)),
  });
}

export function directImplementationTypeParameterPositions(
  document: RustdocDocument,
  impl: Readonly<Record<string, unknown>>,
  implementationGenerics: RustCompilerGenerics,
  declaredGenerics: RustCompilerGenerics,
  ownerCanonicalPath: readonly string[],
  context: RustCompilerNormalizationContext,
): ReadonlyMap<string, number> | undefined {
  const target = normalizeType(document, impl.for, context);
  if (target.kind !== "path" || canonicalCompilerTypePathKey(target) !== canonicalPathKey(ownerCanonicalPath)) {
    return undefined;
  }
  const declared = declaredGenerics.parameters;
  if (target.arguments.length > declared.length) return undefined;
  const positions = new Map<string, number>();
  for (let index = 0; index < target.arguments.length; index += 1) {
    const argument = target.arguments[index]!;
    const parameter = declared[index];
    if (parameter === undefined || argument.kind !== parameter.kind) return undefined;
    if (argument.kind !== "type") continue;
    if (argument.value.kind !== "type-parameter") continue;
    const typeParameter = argument.value;
    if (!implementationGenerics.parameters.some(
      (candidate) => candidate.kind === "type" && candidate.identity.itemId === typeParameter.identity.itemId,
    )) continue;
    if (positions.has(typeParameter.identity.itemId)) return undefined;
    positions.set(typeParameter.identity.itemId, index);
  }
  return positions;
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
    case "unit":
    case "never":
      return structuralBuiltinSupportsTrait(traitPath);
    case "tuple":
      return structuralBuiltinSupportsTrait(traitPath) &&
        type.elements.every((element) => compilerTypeSupportsTrait(document, element, trait, context, active));
    case "array":
      return structuralBuiltinSupportsTrait(traitPath) &&
        compilerTypeSupportsTrait(document, type.element, trait, context, active);
    case "reference":
      return !type.mutable && (traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone");
    case "function-pointer":
    case "raw-pointer":
      return traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone";
    case "path":
      return compilerPathTypeSupportsTrait(document, type, trait, context, active);
    case "type-parameter": {
      const parameter = compilerTypeParameterByIdentity(context, type.identity.itemId);
      return parameter?.kind === "type" && typeParameterGuaranteesTrait(parameter, trait);
    }
    case "self":
    case "associated-type":
    case "trait-object":
    case "opaque":
    case "slice":
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
      if (rustCompilerTraitSemanticKey(selectedTrait) !== rustCompilerTraitSemanticKey(trait)) continue;
      const substitutions = directImplementationSubstitutions(document, impl, type, implContext);
      if (substitutions === undefined) continue;
      if (generics.parameters.every((parameter) => parameter.kind !== "type" || parameter.bounds.every((bound) =>
        bound.kind !== "trait" || compilerTypeSupportsTrait(
          document,
          substitutions.types.get(parameter.identity.itemId) ?? Object.freeze({
            kind: "type-parameter" as const,
            identity: parameter.identity,
            displayName: parameter.displayName,
          }),
          bound.trait,
          implContext,
          active,
        )))) return true;
    }
    return false;
  } finally {
    active.delete(activeKey);
  }
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
  if (structuralBuiltinSupportsTrait(traitPath)) return true;
  const integral = name === "bool" || name === "char" || /^(?:[iu](?:8|16|32|64|128)|isize|usize)$/u.test(name);
  return integral && (traitPath === "core::cmp::Eq" || traitPath === "core::hash::Hash" ||
    traitPath === "core::cmp::Ord" || traitPath === "core::cmp::PartialOrd");
}

function structuralBuiltinSupportsTrait(traitPath: string): boolean {
  return traitPath === "core::marker::Copy" || traitPath === "core::clone::Clone" ||
    traitPath === "core::fmt::Debug" || traitPath === "core::default::Default" ||
    traitPath === "core::cmp::PartialEq" || traitPath === "core::cmp::Eq" ||
    traitPath === "core::hash::Hash" || traitPath === "core::cmp::PartialOrd" ||
    traitPath === "core::cmp::Ord" || traitPath === "core::marker::Send" ||
    traitPath === "core::marker::Sync" || traitPath === "core::marker::Unpin";
}

function traitImplementationKey(implementation: RustCompilerTraitImplementation): string {
  return `${rustCompilerTraitSemanticKey(implementation.trait)}\0${implementation.requirements
    .map((requirement) => `${requirement.typeArgumentIndex}:${rustCompilerTraitSemanticKey(requirement.trait)}`)
    .join("\0")}`;
}

function rustCompilerArgumentKey(argument: import("../model.js").RustCompilerGenericArgument): string {
  return rustCompilerArgumentSemanticKey(argument);
}
