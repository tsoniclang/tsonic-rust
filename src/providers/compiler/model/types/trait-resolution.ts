import {
  compareText,
  hasInnerKind,
  isRecord,
  itemById,
  requireArray,
  requireInnerRecord,
  requireRecord,
} from "../rustdoc-schema.js";
import {
  canonicalCompilerItemIdentity,
  ownedCompilerItemIdentity,
  resolveRustdocCanonicalItem,
} from "../rustdoc-items.js";
import {
  rustCompilerTraitSemanticKey,
  substituteRustCompilerArgument,
  substituteRustCompilerBound,
  substituteRustCompilerConstExpression,
  substituteRustCompilerType,
} from "./substitution.js";
import type {
  RustCompilerDependency,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
  RustCompilerItemIdentity,
  RustCompilerLifetime,
  RustCompilerTraitReference,
  RustCompilerType,
} from "../model.js";
import type { RustdocDocument } from "../rustdoc-schema.js";
import type { RustCompilerNormalizationContext } from "./normalization.js";
import type { RustCompilerSubstitutions } from "./substitution.js";

interface RustCompilerTraitNormalizationServices {
  normalizeGenerics(
    document: RustdocDocument,
    raw: Readonly<Record<string, unknown>>,
    context: RustCompilerNormalizationContext,
  ): RustCompilerGenerics;
  genericParameterMap(
    generics: RustCompilerGenerics,
  ): ReadonlyMap<string, RustCompilerGenericParameter>;
  normalizeTraitReference(
    document: RustdocDocument,
    raw: unknown,
    context: RustCompilerNormalizationContext,
  ): RustCompilerTraitReference;
}

export function resolveExactSuperTraitReference(
  document: RustdocDocument,
  selectedTrait: RustCompilerTraitReference,
  targetIdentity: RustCompilerItemIdentity,
  context: RustCompilerNormalizationContext,
  services: RustCompilerTraitNormalizationServices,
): RustCompilerTraitReference | undefined {
  type TraitLevel = {
    readonly document: RustdocDocument;
    readonly dependency: RustCompilerDependency;
    readonly item: Readonly<Record<string, unknown>>;
    readonly trait: RustCompilerTraitReference;
  };
  const root = resolveRustdocCanonicalItem(
    document,
    context.dependency,
    selectedTrait.identity.canonicalPath,
    Object.freeze(["trait"]),
    context.resolveItem,
  );
  if (root === undefined) return undefined;
  let level: readonly TraitLevel[] = [Object.freeze({
    document: root.document,
    dependency: root.dependency,
    item: root.item,
    trait: selectedTrait,
  })];
  const visited = new Map<string, string>();
  while (level.length > 0) {
    const matches = new Map<string, RustCompilerTraitReference>();
    const next = new Map<string, TraitLevel>();
    for (const owner of level) {
      const semanticKey = rustCompilerTraitSemanticKey(owner.trait);
      const previous = visited.get(owner.trait.identity.itemId);
      if (previous !== undefined) {
        if (previous !== semanticKey) {
          throw new Error(
            `Rust supertrait '${owner.trait.identity.canonicalPath.join("::")}' has contradictory exact instantiations.`,
          );
        }
        continue;
      }
      visited.set(owner.trait.identity.itemId, semanticKey);
      if (owner.trait.identity.itemId === targetIdentity.itemId &&
        canonicalPathKey(owner.trait.identity.canonicalPath) === canonicalPathKey(targetIdentity.canonicalPath)) {
        matches.set(semanticKey, owner.trait);
        continue;
      }
      const declaration = requireInnerRecord(owner.item, "trait", "Rust exact supertrait declaration");
      const generics = services.normalizeGenerics(
        owner.document,
        requireRecord(declaration.generics, "Rust exact supertrait generics"),
        {
          dependency: owner.dependency,
          owner: owner.trait.identity,
          genericOwnerKind: "trait",
          ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
        },
      );
      const substitutions = traitReferenceSubstitutions(generics, owner.trait.arguments);
      const declarationContext: RustCompilerNormalizationContext = {
        dependency: owner.dependency,
        owner: owner.trait.identity,
        parameters: services.genericParameterMap(generics),
        ...(context.resolveItem === undefined ? {} : { resolveItem: context.resolveItem }),
      };
      for (const rawBound of requireArray(declaration.bounds, "Rust exact supertrait bounds")) {
        const bound = requireRecord(rawBound, "Rust exact supertrait bound");
        if (!isRecord(bound.trait_bound)) continue;
        const rawTrait = requireRecord(bound.trait_bound.trait, "Rust exact supertrait reference");
        const normalized = substituteTraitReference(
          services.normalizeTraitReference(owner.document, rawTrait, declarationContext),
          substitutions,
        );
        const resolved = resolveRustdocCanonicalItem(
          owner.document,
          owner.dependency,
          normalized.identity.canonicalPath,
          Object.freeze(["trait"]),
          context.resolveItem,
        );
        if (resolved === undefined) {
          throw new Error(
            `Rust supertrait '${normalized.identity.canonicalPath.join("::")}' has no exact declaration.`,
          );
        }
        const key = rustCompilerTraitSemanticKey(normalized);
        next.set(key, Object.freeze({
          document: resolved.document,
          dependency: resolved.dependency,
          item: resolved.item,
          trait: normalized,
        }));
      }
    }
    if (matches.size > 0) {
      if (matches.size !== 1) {
        throw new Error(
          `Rust supertrait '${targetIdentity.canonicalPath.join("::")}' has ${matches.size} nearest exact instantiations.`,
        );
      }
      return matches.values().next().value;
    }
    level = Object.freeze([...next.values()]);
  }
  return undefined;
}

export function traitReferenceSubstitutions(
  generics: RustCompilerGenerics,
  arguments_: readonly RustCompilerGenericArgument[],
): RustCompilerSubstitutions {
  const parameters = generics.parameters.filter((parameter) =>
    parameter.kind !== "type" || parameter.declarationKind === "explicit");
  if (arguments_.length > parameters.length) {
    throw new Error("Rust trait reference supplies more arguments than its exact declaration.");
  }
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, RustCompilerLifetime>();
  const consts = new Map<string, import("../model.js").RustCompilerConstExpression>();
  const substitutions: RustCompilerSubstitutions = { types, lifetimes, consts };
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]!;
    const selected = arguments_[index];
    if (selected !== undefined && selected.kind !== parameter.kind) {
      throw new Error(`Rust trait argument ${index} does not match its exact generic parameter kind.`);
    }
    if (parameter.kind === "type") {
      const value = selected?.kind === "type"
        ? selected.value
        : parameter.defaultType === undefined
          ? undefined
          : substituteRustCompilerType(parameter.defaultType, substitutions);
      if (value === undefined) throw new Error(`Rust trait type parameter '${parameter.displayName}' has no exact argument.`);
      types.set(parameter.identity.itemId, value);
    } else if (parameter.kind === "lifetime") {
      if (selected?.kind !== "lifetime") {
        throw new Error("Rust trait lifetime parameter has no exact argument.");
      }
      if (parameter.identity.kind !== "parameter") {
        throw new Error("Rust trait lifetime parameter has no declaration-backed identity.");
      }
      lifetimes.set(parameter.identity.identity.itemId, selected.value);
    } else {
      const value = selected?.kind === "const"
        ? selected.value
        : parameter.defaultValue === undefined
          ? undefined
          : substituteRustCompilerConstExpression(parameter.defaultValue, substitutions);
      if (value === undefined) throw new Error(`Rust trait const parameter '${parameter.displayName}' has no exact argument.`);
      consts.set(parameter.identity.itemId, value);
    }
  }
  return Object.freeze(substitutions);
}

function substituteTraitReference(
  trait: RustCompilerTraitReference,
  substitutions: RustCompilerSubstitutions,
): RustCompilerTraitReference {
  return Object.freeze({
    ...trait,
    arguments: Object.freeze(trait.arguments.map((argument) =>
      substituteRustCompilerArgument(argument, substitutions))),
    associatedConstraints: Object.freeze(trait.associatedConstraints.map((constraint) =>
      constraint.kind === "equality"
        ? Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map((argument) =>
              substituteRustCompilerArgument(argument, substitutions))),
            type: substituteRustCompilerType(constraint.type, substitutions),
          })
        : Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map((argument) =>
              substituteRustCompilerArgument(argument, substitutions))),
            bounds: Object.freeze(constraint.bounds.map((bound) =>
              substituteRustCompilerBound(bound, substitutions))),
          }))),
  });
}

export function exactAssociatedTypeIdentity(
  document: RustdocDocument,
  trait: RustCompilerItemIdentity,
  displayName: string,
  context: RustCompilerNormalizationContext,
): RustCompilerItemIdentity {
  const localCandidates = Object.entries(document.paths)
    .filter(([, rawPath]) => {
      if (!isRecord(rawPath) || rawPath.kind !== "trait" || !Array.isArray(rawPath.path)) {
        return false;
      }
      return rawPath.path.length === trait.canonicalPath.length &&
        rawPath.path.every((segment, index) => segment === trait.canonicalPath[index]);
    })
    .map(([id]) => id)
    .sort(compareText);
  if (localCandidates.length !== 1) {
    throw new Error(
      `Rust associated type owner '${trait.canonicalPath.join("::")}' resolves to ${localCandidates.length} exact compiler paths.`,
    );
  }
  const localId = localCandidates[0]!;
  const resolved = context.resolveItem?.(document, context.dependency, localId);
  const traitDocument = resolved?.document ?? document;
  const traitDependency = resolved?.dependency ?? context.dependency;
  const traitItem = resolved?.item ?? document.index[localId];
  if (!isRecord(traitItem)) {
    throw new Error(`Rust associated type '${displayName}' has no declaration in the active compiler document.`);
  }
  const resolvedIdentity = canonicalCompilerItemIdentity(traitDocument, traitDependency, traitItem);
  if (resolvedIdentity.itemId !== trait.itemId ||
    canonicalPathKey(resolvedIdentity.canonicalPath) !== canonicalPathKey(trait.canonicalPath)) {
    throw new Error(
      `Rust associated type owner '${trait.canonicalPath.join("::")}' does not agree with its resolved compiler identity.`,
    );
  }
  let level = [Object.freeze({
    document: traitDocument,
    dependency: traitDependency,
    item: traitItem,
    identity: resolvedIdentity,
  })];
  const visited = new Set<string>();
  while (level.length > 0) {
    const declarations = new Map<string, RustCompilerItemIdentity>();
    const next = new Map<string, (typeof level)[number]>();
    for (const owner of level) {
      if (visited.has(owner.identity.itemId)) continue;
      visited.add(owner.identity.itemId);
      const declaration = requireRecord(
        requireRecord(owner.item.inner, "Rust associated type owner").trait,
        "Rust associated type owner trait",
      );
      for (const id of requireArray(declaration.items, "Rust associated type owner items")) {
        const item = itemById(owner.document, id);
        if (item.name !== displayName || !isRecord(item.inner) || !isRecord(item.inner.assoc_type)) continue;
        const identity = ownedCompilerItemIdentity(owner.dependency, owner.identity, item);
        declarations.set(identity.itemId, identity);
      }
      for (const bound of requireArray(declaration.bounds, "Rust associated type owner bounds")) {
        const rawBound = requireRecord(bound, "Rust associated type owner bound");
        if (!isRecord(rawBound.trait_bound)) continue;
        const rawTrait = requireRecord(rawBound.trait_bound.trait, "Rust associated type supertrait");
        const id = rawTrait.id;
        if (typeof id !== "number" && typeof id !== "string") {
          throw new Error("Rust associated type supertrait has no exact compiler identity.");
        }
        const resolvedSuper = context.resolveItem?.(owner.document, owner.dependency, id);
        const superItem = resolvedSuper?.item ?? owner.document.index[String(id)];
        if (!isRecord(superItem) || !hasInnerKind(superItem, "trait")) {
          throw new Error(`Rust associated type supertrait '${String(id)}' is not an exact trait declaration.`);
        }
        const superDocument = resolvedSuper?.document ?? owner.document;
        const superDependency = resolvedSuper?.dependency ?? owner.dependency;
        const superIdentity = canonicalCompilerItemIdentity(superDocument, superDependency, superItem);
        next.set(superIdentity.itemId, Object.freeze({
          document: superDocument,
          dependency: superDependency,
          item: superItem,
          identity: superIdentity,
        }));
      }
    }
    if (declarations.size > 0) {
      if (declarations.size !== 1) {
        throw new Error(`Rust associated type '${displayName}' has ${declarations.size} nearest declarations.`);
      }
      return declarations.values().next().value!;
    }
    level = [...next.values()];
  }
  throw new Error(`Rust associated type '${displayName}' has no declaration in its exact supertrait closure.`);
}

function canonicalPathKey(path: readonly string[]): string {
  return path.join("\0");
}
