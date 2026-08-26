import {
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "./carriers/source-types.js";
import { rustSemanticIdentityKey, rustTypeSemanticKey } from "../semantics/index.js";
import type {
  RustBound,
  RustCapturedGeneric,
  RustConstExpr,
  RustGenericArgument,
  RustGenerics,
  RustLifetimeRef,
  RustTraitRef,
} from "../semantics/index.js";
import type { TargetTypeRef } from "./model.js";

export function rustTargetTypeOpenGenericIdentityKeys(
  type: TargetTypeRef,
): readonly string[] {
  const identities = new Set<string>();
  collectTypeIdentities(type, identities);
  return Object.freeze([...identities].sort());
}

export function rustGenericArgumentOpenIdentityKeys(
  argument: RustGenericArgument,
): readonly string[] {
  const identities = new Set<string>();
  collectArgumentIdentities(argument, identities);
  return Object.freeze([...identities].sort());
}

export function rustTraitOpenGenericIdentityKeys(trait: RustTraitRef): readonly string[] {
  const identities = new Set<string>();
  collectTraitIdentities(trait, identities);
  return Object.freeze([...identities].sort());
}

export function rustBoundOpenGenericIdentityKeys(bound: RustBound): readonly string[] {
  const identities = new Set<string>();
  collectBoundIdentities(bound, identities);
  return Object.freeze([...identities].sort());
}

export function rustTargetTypeAssociatedProjectionKeys(
  type: TargetTypeRef,
): readonly string[] {
  const projections = new Set<string>();
  collectTypeAssociatedProjections(type, projections);
  return Object.freeze([...projections].sort());
}

export function rustGenericArgumentAssociatedProjectionKeys(
  argument: RustGenericArgument,
): readonly string[] {
  const projections = new Set<string>();
  collectArgumentAssociatedProjections(argument, projections);
  return Object.freeze([...projections].sort());
}

export function rustTraitAssociatedProjectionKeys(
  trait: RustTraitRef,
): readonly string[] {
  const projections = new Set<string>();
  collectTraitAssociatedProjections(trait, projections);
  return Object.freeze([...projections].sort());
}

export function rustGenericsAssociatedProjectionKeys(
  generics: RustGenerics,
): readonly string[] {
  const projections = new Set<string>();
  for (const parameter of generics.parameters) {
    if (parameter.kind === "type") {
      parameter.bounds.forEach((bound) => collectBoundAssociatedProjections(bound, projections));
      if (parameter.defaultType !== undefined) {
        collectTypeAssociatedProjections(parameter.defaultType, projections);
      }
    } else if (parameter.kind === "const") {
      collectTypeAssociatedProjections(parameter.type, projections);
    }
  }
  for (const predicate of generics.wherePredicates) {
    if (predicate.kind === "type") {
      collectTypeAssociatedProjections(predicate.type, projections);
      predicate.bounds.forEach((bound) => collectBoundAssociatedProjections(bound, projections));
    } else if (predicate.kind === "equality") {
      collectTypeAssociatedProjections(predicate.projection, projections);
      collectTypeAssociatedProjections(predicate.value, projections);
    }
  }
  return Object.freeze([...projections].sort());
}

export function rustGenericsOpenGenericIdentityKeys(
  generics: RustGenerics,
): readonly string[] {
  const identities = new Set<string>();
  for (const parameter of generics.parameters) {
    if (parameter.kind === "lifetime") {
      parameter.bounds.forEach((lifetime) => collectLifetimeIdentities(lifetime, identities));
    } else if (parameter.kind === "type") {
      parameter.bounds.forEach((bound) => collectBoundIdentities(bound, identities));
      if (parameter.defaultType !== undefined) {
        collectTypeIdentities(parameter.defaultType, identities);
      }
    } else {
      collectTypeIdentities(parameter.type, identities);
      if (parameter.defaultValue !== undefined) {
        collectConstIdentities(parameter.defaultValue, identities);
      }
    }
  }
  for (const predicate of generics.wherePredicates) {
    if (predicate.kind === "lifetime") {
      collectLifetimeIdentities(predicate.lifetime, identities);
      predicate.outlives.forEach((lifetime) => collectLifetimeIdentities(lifetime, identities));
    } else if (predicate.kind === "equality") {
      collectTypeIdentities(predicate.projection, identities);
      collectTypeIdentities(predicate.value, identities);
    } else {
      collectTypeIdentities(predicate.type, identities);
      predicate.bounds.forEach((bound) => collectBoundIdentities(bound, identities));
    }
  }
  return Object.freeze([...identities].sort());
}

function collectTypeIdentities(type: TargetTypeRef, identities: Set<string>): void {
  switch (type.kind) {
    case "type-parameter":
      identities.add(rustSemanticIdentityKey(type.identity));
      return;
    case "path":
      type.arguments.forEach((argument) => collectArgumentIdentities(argument, identities));
      return;
    case "array":
      collectTypeIdentities(type.element, identities);
      collectConstIdentities(type.length, identities);
      return;
    case "sequence":
    case "slice":
      collectTypeIdentities(type.element, identities);
      return;
    case "tuple":
      type.elements.forEach((element) => collectTypeIdentities(element, identities));
      return;
    case "reference":
      collectLifetimeIdentities(type.lifetime, identities);
      collectTypeIdentities(type.target, identities);
      return;
    case "raw-pointer":
      collectTypeIdentities(type.target, identities);
      return;
    case "function-pointer":
      type.parameters.forEach((parameter) => collectTypeIdentities(parameter, identities));
      collectTypeIdentities(type.result, identities);
      return;
    case "closure":
      type.parameters.forEach((parameter) => collectTypeIdentities(parameter, identities));
      collectTypeIdentities(type.result, identities);
      type.captures.forEach((capture) => collectCaptureIdentities(capture, identities));
      return;
    case "trait-object":
      collectTraitIdentities(type.principal, identities);
      type.autoTraits.forEach((trait) => collectTraitIdentities(trait, identities));
      collectLifetimeIdentities(type.lifetime, identities);
      return;
    case "opaque":
      type.bounds.forEach((bound) => collectBoundIdentities(bound, identities));
      type.captures.forEach((capture) => collectCaptureIdentities(capture, identities));
      return;
    case "associated-type":
      collectTypeIdentities(type.owner, identities);
      collectTraitIdentities(type.trait, identities);
      type.arguments.forEach((argument) => collectArgumentIdentities(argument, identities));
      return;
    case "source-carrier": {
      const sourceType = rustSourceTypeCarrierValue(type);
      sourceType?.genericArguments.forEach((argument) =>
        collectArgumentIdentities(argument, identities));
      const object = rustStructuralObjectCarrierValue(type);
      object?.fields.forEach((field) => collectTypeIdentities(field.type, identities));
      const union = rustSourceUnionCarrierValue(type);
      union?.variants.forEach((variant) => collectTypeIdentities(variant.carrier, identities));
      return;
    }
    case "source-primitive":
    case "primitive":
    case "inference-variable":
    case "never":
    case "unit":
    case "str":
    case "self":
      return;
  }
}

function collectTypeAssociatedProjections(
  type: TargetTypeRef,
  projections: Set<string>,
): void {
  switch (type.kind) {
    case "path":
      type.arguments.forEach((argument) =>
        collectArgumentAssociatedProjections(argument, projections));
      return;
    case "array":
    case "sequence":
    case "slice":
      collectTypeAssociatedProjections(type.element, projections);
      return;
    case "tuple":
      type.elements.forEach((element) => collectTypeAssociatedProjections(element, projections));
      return;
    case "reference":
    case "raw-pointer":
      collectTypeAssociatedProjections(type.target, projections);
      return;
    case "function-pointer":
    case "closure":
      type.parameters.forEach((parameter) =>
        collectTypeAssociatedProjections(parameter, projections));
      collectTypeAssociatedProjections(type.result, projections);
      return;
    case "trait-object":
      collectTraitAssociatedProjections(type.principal, projections);
      type.autoTraits.forEach((trait) =>
        collectTraitAssociatedProjections(trait, projections));
      return;
    case "opaque":
      type.bounds.forEach((bound) => collectBoundAssociatedProjections(bound, projections));
      return;
    case "associated-type":
      projections.add(rustTypeSemanticKey(type));
      collectTypeAssociatedProjections(type.owner, projections);
      collectTraitAssociatedProjections(type.trait, projections);
      type.arguments.forEach((argument) =>
        collectArgumentAssociatedProjections(argument, projections));
      return;
    case "source-carrier": {
      rustSourceTypeCarrierValue(type)?.genericArguments.forEach((argument) =>
        collectArgumentAssociatedProjections(argument, projections));
      rustStructuralObjectCarrierValue(type)?.fields.forEach((field) =>
        collectTypeAssociatedProjections(field.type, projections));
      rustSourceUnionCarrierValue(type)?.variants.forEach((variant) =>
        collectTypeAssociatedProjections(variant.carrier, projections));
      return;
    }
    case "type-parameter":
    case "source-primitive":
    case "primitive":
    case "inference-variable":
    case "never":
    case "unit":
    case "str":
    case "self":
      return;
  }
}

function collectArgumentAssociatedProjections(
  argument: RustGenericArgument,
  projections: Set<string>,
): void {
  if (argument.kind === "type") {
    collectTypeAssociatedProjections(argument.value, projections);
  }
}

function collectTraitAssociatedProjections(
  trait: RustTraitRef,
  projections: Set<string>,
): void {
  trait.arguments.forEach((argument) =>
    collectArgumentAssociatedProjections(argument, projections));
  trait.associatedConstraints.forEach((constraint) => {
    constraint.arguments.forEach((argument) =>
      collectArgumentAssociatedProjections(argument, projections));
    if (constraint.kind === "equality") {
      collectTypeAssociatedProjections(constraint.type, projections);
    } else {
      constraint.bounds.forEach((bound) =>
        collectBoundAssociatedProjections(bound, projections));
    }
  });
}

function collectBoundAssociatedProjections(
  bound: RustBound,
  projections: Set<string>,
): void {
  switch (bound.kind) {
    case "trait":
      collectTraitAssociatedProjections(bound.trait, projections);
      return;
    case "type-outlives":
      collectTypeAssociatedProjections(bound.type, projections);
      return;
    case "associated-equality":
      collectTypeAssociatedProjections(bound.projection, projections);
      collectTypeAssociatedProjections(bound.value, projections);
      return;
    case "lifetime-outlives":
      return;
  }
}

function collectArgumentIdentities(argument: RustGenericArgument, identities: Set<string>): void {
  switch (argument.kind) {
    case "lifetime":
      collectLifetimeIdentities(argument.value, identities);
      return;
    case "type":
      collectTypeIdentities(argument.value, identities);
      return;
    case "const":
      collectConstIdentities(argument.value, identities);
      return;
  }
}

function collectLifetimeIdentities(lifetime: RustLifetimeRef, identities: Set<string>): void {
  if (lifetime.kind === "parameter") identities.add(rustSemanticIdentityKey(lifetime.identity));
}

function collectConstIdentities(expression: RustConstExpr, identities: Set<string>): void {
  switch (expression.kind) {
    case "parameter":
      identities.add(rustSemanticIdentityKey(expression.identity));
      return;
    case "unary":
      collectConstIdentities(expression.operand, identities);
      return;
    case "binary":
      collectConstIdentities(expression.left, identities);
      collectConstIdentities(expression.right, identities);
      return;
    case "literal":
    case "item":
    case "inferred":
      return;
  }
}

function collectTraitIdentities(trait: RustTraitRef, identities: Set<string>): void {
  trait.arguments.forEach((argument) => collectArgumentIdentities(argument, identities));
  trait.associatedConstraints.forEach((constraint) => {
    constraint.arguments.forEach((argument) => collectArgumentIdentities(argument, identities));
    if (constraint.kind === "equality") collectTypeIdentities(constraint.type, identities);
    else constraint.bounds.forEach((bound) => collectBoundIdentities(bound, identities));
  });
}

function collectBoundIdentities(bound: RustBound, identities: Set<string>): void {
  switch (bound.kind) {
    case "trait":
      collectTraitIdentities(bound.trait, identities);
      return;
    case "lifetime-outlives":
      collectLifetimeIdentities(bound.longer, identities);
      collectLifetimeIdentities(bound.shorter, identities);
      return;
    case "type-outlives":
      collectTypeIdentities(bound.type, identities);
      collectLifetimeIdentities(bound.lifetime, identities);
      return;
    case "associated-equality":
      collectTypeIdentities(bound.projection, identities);
      collectTypeIdentities(bound.value, identities);
      return;
  }
}

function collectCaptureIdentities(capture: RustCapturedGeneric, identities: Set<string>): void {
  if (capture.kind === "lifetime") collectLifetimeIdentities(capture.value, identities);
  else identities.add(rustSemanticIdentityKey(capture.identity));
}
