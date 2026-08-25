import {
  substituteRustCompilerArgument,
  substituteRustCompilerBound,
  substituteRustCompilerType,
  type RustCompilerSubstitutions,
} from "../rustdoc-types.js";
import type {
  RustCompilerTraitReference,
  RustCompilerType,
} from "../model.js";

export function normalizeMemberType(
  type: RustCompilerType,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitReference | undefined,
): RustCompilerType {
  return substituteAssociatedTypes(type, bindings, currentTrait, new Set());
}

export function substituteTraitReference(
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

export function associatedTypeKey(
  trait: RustCompilerTraitReference,
  itemId: string,
): string {
  return `${trait.identity.itemId}\0${itemId}`;
}

function substituteAssociatedTypes(
  type: RustCompilerType,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitReference | undefined,
  active: Set<string>,
): RustCompilerType {
  if (type.kind === "associated-type") {
    const trait = type.trait.arguments.length === 0 && currentTrait?.identity.itemId === type.trait.identity.itemId
      ? currentTrait
      : type.trait;
    const key = associatedTypeKey(trait, type.item.itemId);
    const selected = type.owner.kind === "self" ? bindings.get(key) : undefined;
    if (selected !== undefined) {
      if (active.has(key)) throw new Error(`Rust associated type '${type.displayName}' is recursively bound.`);
      active.add(key);
      try {
        return substituteAssociatedTypes(selected, bindings, currentTrait, active);
      } finally {
        active.delete(key);
      }
    }
    return Object.freeze({
      ...type,
      owner: substituteAssociatedTypes(type.owner, bindings, currentTrait, active),
      trait: substituteAssociatedTrait(trait, bindings, currentTrait, active),
      arguments: Object.freeze(type.arguments.map((argument) =>
        substituteAssociatedArgument(argument, bindings, currentTrait, active))),
    });
  }
  switch (type.kind) {
    case "unit":
    case "never":
    case "primitive":
    case "type-parameter":
    case "self":
      return type;
    case "tuple":
      return Object.freeze({
        ...type,
        elements: Object.freeze(type.elements.map((element) =>
          substituteAssociatedTypes(element, bindings, currentTrait, active))),
      });
    case "array":
      return Object.freeze({
        ...type,
        element: substituteAssociatedTypes(type.element, bindings, currentTrait, active),
      });
    case "slice":
      return Object.freeze({
        ...type,
        element: substituteAssociatedTypes(type.element, bindings, currentTrait, active),
      });
    case "reference":
    case "raw-pointer":
      return Object.freeze({
        ...type,
        target: substituteAssociatedTypes(type.target, bindings, currentTrait, active),
      });
    case "function-pointer":
      return Object.freeze({
        ...type,
        parameters: Object.freeze(type.parameters.map((parameter) =>
          substituteAssociatedTypes(parameter, bindings, currentTrait, active))),
        result: substituteAssociatedTypes(type.result, bindings, currentTrait, active),
      });
    case "path":
      return Object.freeze({
        ...type,
        arguments: Object.freeze(type.arguments.map((argument) =>
          substituteAssociatedArgument(argument, bindings, currentTrait, active))),
      });
    case "trait-object":
      return Object.freeze({
        ...type,
        principal: substituteAssociatedTrait(type.principal, bindings, currentTrait, active),
        autoTraits: Object.freeze(type.autoTraits.map((trait) =>
          substituteAssociatedTrait(trait, bindings, currentTrait, active))),
      });
    case "opaque":
      return Object.freeze({
        ...type,
        bounds: Object.freeze(type.bounds.map((bound) =>
          substituteAssociatedBound(bound, bindings, currentTrait, active))),
        captures: Object.freeze(type.captures.map((argument) =>
          substituteAssociatedArgument(argument, bindings, currentTrait, active))),
      });
  }
}

function substituteAssociatedArgument(
  argument: import("../model.js").RustCompilerGenericArgument,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitReference | undefined,
  active: Set<string>,
): import("../model.js").RustCompilerGenericArgument {
  return argument.kind === "type"
    ? Object.freeze({
        kind: "type",
        value: substituteAssociatedTypes(argument.value, bindings, currentTrait, active),
      })
    : argument;
}

function substituteAssociatedTrait(
  trait: RustCompilerTraitReference,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitReference | undefined,
  active: Set<string>,
): RustCompilerTraitReference {
  return Object.freeze({
    ...trait,
    arguments: Object.freeze(trait.arguments.map((argument) =>
      substituteAssociatedArgument(argument, bindings, currentTrait, active))),
    associatedConstraints: Object.freeze(trait.associatedConstraints.map((constraint) =>
      constraint.kind === "equality"
        ? Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map((argument) =>
              substituteAssociatedArgument(argument, bindings, currentTrait, active))),
            type: substituteAssociatedTypes(constraint.type, bindings, currentTrait, active),
          })
        : Object.freeze({
            ...constraint,
            arguments: Object.freeze(constraint.arguments.map((argument) =>
              substituteAssociatedArgument(argument, bindings, currentTrait, active))),
            bounds: Object.freeze(constraint.bounds.map((bound) =>
              substituteAssociatedBound(bound, bindings, currentTrait, active))),
          }))),
  });
}

function substituteAssociatedBound(
  bound: import("../model.js").RustCompilerBound,
  bindings: ReadonlyMap<string, RustCompilerType>,
  currentTrait: RustCompilerTraitReference | undefined,
  active: Set<string>,
): import("../model.js").RustCompilerBound {
  switch (bound.kind) {
    case "trait":
      return Object.freeze({
        ...bound,
        trait: substituteAssociatedTrait(bound.trait, bindings, currentTrait, active),
      });
    case "type-outlives":
      return Object.freeze({
        ...bound,
        type: substituteAssociatedTypes(bound.type, bindings, currentTrait, active),
      });
    case "associated-equality": {
      const projection = substituteAssociatedTypes(bound.projection, bindings, currentTrait, active);
      if (projection.kind !== "associated-type") {
        throw new Error("Rust associated equality substitution changed the projection kind.");
      }
      return Object.freeze({
        ...bound,
        projection,
        value: substituteAssociatedTypes(bound.value, bindings, currentTrait, active),
      });
    }
    case "lifetime-outlives":
    case "precise-capture":
      return bound;
  }
}
