import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustSourceUnionTargetType,
  rustStructuralObjectCarrierValue,
  rustStructuralObjectTargetType,
} from "./carriers/source-types.js";
import { rustPathTargetType } from "./constructors.js";
import {
  rustConstSemanticKey,
  rustLifetimeSemanticKey,
  rustSemanticIdentitiesEqual,
  rustSemanticIdentityKey,
  rustTypeSemanticKey,
} from "../semantics/index.js";
import { rustTargetTypeRefEquals } from "./equality.js";
import { closedMetadataEquals } from "../metadata/closed-data.js";
import type {
  RustBound,
  RustCapturedGeneric,
  RustConstExpr,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
  RustLifetimeRef,
  RustTraitRef,
  RustWherePredicate,
} from "../semantics/index.js";
import type { TargetTypeRef } from "./model.js";

export interface RustGenericSubstitutions {
  readonly lifetimes: ReadonlyMap<string, RustLifetimeRef>;
  readonly types: ReadonlyMap<string, TargetTypeRef>;
  readonly consts: ReadonlyMap<string, RustConstExpr>;
  readonly associatedTypes: ReadonlyMap<string, TargetTypeRef>;
}

export interface RustGenericSubstitutionEntries {
  readonly lifetimes: readonly (readonly [string, RustLifetimeRef])[];
  readonly types: readonly (readonly [string, TargetTypeRef])[];
  readonly consts: readonly (readonly [string, RustConstExpr])[];
  readonly associatedTypes: readonly (readonly [string, TargetTypeRef])[];
}

export interface RustGenericParameterIdentitySets {
  readonly lifetimes: ReadonlySet<string>;
  readonly types: ReadonlySet<string>;
  readonly consts: ReadonlySet<string>;
  readonly associatedTypes: ReadonlySet<string>;
}

export const emptyRustGenericSubstitutions: RustGenericSubstitutions = Object.freeze({
  lifetimes: new Map(),
  types: new Map(),
  consts: new Map(),
  associatedTypes: new Map(),
});

export function rustGenericSubstitutionEntries(
  substitutions: RustGenericSubstitutions,
): RustGenericSubstitutionEntries {
  const ordered = <T>(values: ReadonlyMap<string, T>): readonly (readonly [string, T])[] =>
    Object.freeze([...values]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([identity, value]) => Object.freeze([identity, value] as const)));
  return Object.freeze({
    lifetimes: ordered(substitutions.lifetimes),
    types: ordered(substitutions.types),
    consts: ordered(substitutions.consts),
    associatedTypes: ordered(substitutions.associatedTypes),
  });
}

export function rustGenericSubstitutionsFromEntries(
  entries: RustGenericSubstitutionEntries,
): RustGenericSubstitutions | undefined {
  const lifetimes = uniqueEntries(entries.lifetimes);
  const types = uniqueEntries(entries.types);
  const consts = uniqueEntries(entries.consts);
  const associatedTypes = uniqueEntries(entries.associatedTypes);
  return lifetimes === undefined || types === undefined || consts === undefined ||
      associatedTypes === undefined
    ? undefined
    : Object.freeze({ lifetimes, types, consts, associatedTypes });
}

function uniqueEntries<T>(
  entries: readonly (readonly [string, T])[],
): ReadonlyMap<string, T> | undefined {
  const values = new Map<string, T>();
  for (const [identity, value] of entries) {
    if (identity.length === 0 || values.has(identity)) return undefined;
    values.set(identity, value);
  }
  return values;
}

export function mergeRustGenericSubstitutions(
  ...inputs: readonly RustGenericSubstitutions[]
): RustGenericSubstitutions | undefined {
  const lifetimes = new Map<string, RustLifetimeRef>();
  const types = new Map<string, TargetTypeRef>();
  const consts = new Map<string, RustConstExpr>();
  const associatedTypes = new Map<string, TargetTypeRef>();
  for (const input of inputs) {
    for (const [identity, lifetime] of input.lifetimes) {
      const existing = lifetimes.get(identity);
      if (existing !== undefined &&
        rustLifetimeSemanticKey(existing) !== rustLifetimeSemanticKey(lifetime)) return undefined;
      lifetimes.set(identity, lifetime);
    }
    for (const [identity, type] of input.types) {
      const existing = types.get(identity);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing, type)) return undefined;
      types.set(identity, type);
    }
    for (const [identity, expression] of input.consts) {
      const existing = consts.get(identity);
      if (existing !== undefined &&
        rustConstSemanticKey(existing) !== rustConstSemanticKey(expression)) return undefined;
      consts.set(identity, expression);
    }
    for (const [projectionKey, type] of input.associatedTypes) {
      const existing = associatedTypes.get(projectionKey);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing, type)) return undefined;
      associatedTypes.set(projectionKey, type);
    }
  }
  return Object.freeze({ lifetimes, types, consts, associatedTypes });
}

export function rustGenericParameterIdentityKey(
  parameter: RustGenericParameter,
): string | undefined {
  return parameter.kind === "lifetime"
    ? parameter.identity.kind === "parameter"
      ? rustSemanticIdentityKey(parameter.identity.identity)
      : undefined
    : rustSemanticIdentityKey(parameter.identity);
}

export function rustGenericSubstitutionsForArguments(
  generics: RustGenerics,
  arguments_: readonly RustGenericArgument[],
): RustGenericSubstitutions | undefined {
  if (generics.parameters.length !== arguments_.length) return undefined;
  const lifetimes = new Map<string, RustLifetimeRef>();
  const types = new Map<string, TargetTypeRef>();
  const consts = new Map<string, RustConstExpr>();
  const associatedTypes = new Map<string, TargetTypeRef>();
  for (let index = 0; index < generics.parameters.length; index += 1) {
    const parameter = generics.parameters[index]!;
    const argument = arguments_[index];
    const key = rustGenericParameterIdentityKey(parameter);
    if (argument === undefined || argument.kind !== parameter.kind || key === undefined) {
      return undefined;
    }
    if (argument.kind === "lifetime") lifetimes.set(key, argument.value);
    else if (argument.kind === "type") types.set(key, argument.value);
    else consts.set(key, argument.value);
  }
  return Object.freeze({ lifetimes, types, consts, associatedTypes });
}

export function rustGenericSubstitutionsForOpenArguments(
  parameters: readonly RustGenericArgument[],
  arguments_: readonly RustGenericArgument[],
): RustGenericSubstitutions | undefined {
  if (parameters.length !== arguments_.length) return undefined;
  const lifetimes = new Map<string, RustLifetimeRef>();
  const types = new Map<string, TargetTypeRef>();
  const consts = new Map<string, RustConstExpr>();
  const associatedTypes = new Map<string, TargetTypeRef>();
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]!;
    const argument = arguments_[index];
    const identity = rustGenericParameterIdentity(parameter);
    if (argument === undefined || argument.kind !== parameter.kind || identity === undefined) {
      return undefined;
    }
    if (argument.kind === "lifetime") lifetimes.set(identity.identityKey, argument.value);
    else if (argument.kind === "type") types.set(identity.identityKey, argument.value);
    else consts.set(identity.identityKey, argument.value);
  }
  return Object.freeze({ lifetimes, types, consts, associatedTypes });
}

export function rustTypeArgumentsFromGenericArguments(
  arguments_: readonly RustGenericArgument[],
): readonly TargetTypeRef[] | undefined {
  return arguments_.every((argument) => argument.kind === "type")
    ? Object.freeze(arguments_.map((argument) =>
        (argument as Extract<RustGenericArgument, { readonly kind: "type" }>).value))
    : undefined;
}

export function rustGenericParameterIdentity(
  argument: RustGenericArgument,
): { readonly kind: RustGenericArgument["kind"]; readonly identityKey: string } | undefined {
  const identity = argument.kind === "lifetime" && argument.value.kind === "parameter"
    ? argument.value.identity
    : argument.kind === "type" && argument.value.kind === "type-parameter"
      ? argument.value.identity
      : argument.kind === "const" && argument.value.kind === "parameter"
        ? argument.value.identity
        : undefined;
  return identity === undefined
    ? undefined
    : Object.freeze({ kind: argument.kind, identityKey: rustSemanticIdentityKey(identity) });
}

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

export function rustGenericsDeclaredParameterIdentities(
  generics: RustGenerics,
): RustGenericParameterIdentitySets {
  const lifetimes = new Set<string>();
  const types = new Set<string>();
  const consts = new Set<string>();
  for (const parameter of generics.parameters) {
    const key = parameter.kind === "lifetime"
      ? parameter.identity.kind === "parameter"
        ? rustSemanticIdentityKey(parameter.identity.identity)
        : undefined
      : rustSemanticIdentityKey(parameter.identity);
    if (key === undefined) continue;
    if (parameter.kind === "lifetime") lifetimes.add(key);
    else if (parameter.kind === "type") types.add(key);
    else consts.add(key);
  }
  return Object.freeze({ lifetimes, types, consts, associatedTypes: new Set<string>() });
}

export function inferRustTargetGenericSubstitutions(
  pattern: TargetTypeRef,
  actual: TargetTypeRef,
  parameters: RustGenericParameterIdentitySets,
  initial: RustGenericSubstitutions = emptyRustGenericSubstitutions,
): RustGenericSubstitutions | undefined {
  const substitutions = {
    lifetimes: new Map(initial.lifetimes),
    types: new Map(initial.types),
    consts: new Map(initial.consts),
    associatedTypes: new Map(initial.associatedTypes),
  };
  return matchType(pattern, actual) ? substitutions : undefined;

  function matchType(left: TargetTypeRef, right: TargetTypeRef): boolean {
    if (left.kind === "type-parameter") {
      const key = rustSemanticIdentityKey(left.identity);
      if (parameters.types.has(key)) return mergeType(key, right);
    }
    if (left.kind === "associated-type" &&
      parameters.associatedTypes.has(rustTypeSemanticKey(left))) {
      const projection = substituteAssociatedProjectionShape(left, substitutions);
      return mergeAssociatedType(rustTypeSemanticKey(projection), right);
    }
    if (left.kind !== right.kind) return false;
    switch (left.kind) {
      case "path":
        return right.kind === "path" &&
          rustSemanticIdentitiesEqual(left.identity, right.identity) &&
          matchArguments(left.arguments, right.arguments);
      case "array":
        return right.kind === "array" && matchConst(left.length, right.length) &&
          matchType(left.element, right.element);
      case "sequence":
      case "slice":
        return right.kind === left.kind && matchType(left.element, right.element);
      case "tuple":
        return right.kind === "tuple" && left.elements.length === right.elements.length &&
          left.elements.every((element, index) => matchType(element, right.elements[index]!));
      case "reference":
        return right.kind === "reference" && left.mutable === right.mutable &&
          matchLifetime(left.lifetime, right.lifetime) && matchType(left.target, right.target);
      case "raw-pointer":
        return right.kind === "raw-pointer" && left.mutable === right.mutable &&
          matchType(left.target, right.target);
      case "function-pointer":
        return right.kind === "function-pointer" && left.safety === right.safety &&
          left.abi === right.abi && left.variadic === right.variadic &&
          closedMetadataEquals(left.binder, right.binder) &&
          left.parameters.length === right.parameters.length &&
          left.parameters.every((parameter, index) =>
            matchType(parameter, right.parameters[index]!)) &&
          matchType(left.result, right.result);
      case "closure":
        return right.kind === "closure" && left.callTrait === right.callTrait &&
          closedMetadataEquals(left.binder, right.binder) &&
          left.parameters.length === right.parameters.length &&
          left.parameters.every((parameter, index) =>
            matchType(parameter, right.parameters[index]!)) &&
          matchType(left.result, right.result) &&
          closedMetadataEquals(left.captures, right.captures);
      case "trait-object":
        return right.kind === "trait-object" &&
          matchTrait(left.principal, right.principal) &&
          left.autoTraits.length === right.autoTraits.length &&
          left.autoTraits.every((trait, index) => matchTrait(trait, right.autoTraits[index]!)) &&
          matchLifetime(left.lifetime, right.lifetime);
      case "opaque":
        return right.kind === "opaque" &&
          rustSemanticIdentitiesEqual(left.identity, right.identity) &&
          closedMetadataEquals(
            left.bounds.map((bound) => substituteRustBound(bound, substitutions)),
            right.bounds,
          ) && closedMetadataEquals(left.captures, right.captures);
      case "associated-type":
        return right.kind === "associated-type" &&
          rustSemanticIdentitiesEqual(left.item, right.item) &&
          matchType(left.owner, right.owner) && matchTrait(left.trait, right.trait) &&
          matchArguments(left.arguments, right.arguments);
      case "source-carrier":
        return right.kind === "source-carrier" && matchSourceCarrier(left, right);
      case "type-parameter":
      case "source-primitive":
      case "primitive":
      case "inference-variable":
      case "never":
      case "unit":
      case "str":
      case "self":
        return rustTargetTypeRefEquals(left, right);
    }
  }

  function matchArguments(
    left: readonly RustGenericArgument[],
    right: readonly RustGenericArgument[],
  ): boolean {
    return left.length === right.length && left.every((argument, index) => {
      const other = right[index]!;
      if (argument.kind !== other.kind) return false;
      return argument.kind === "type" && other.kind === "type"
        ? matchType(argument.value, other.value)
        : argument.kind === "lifetime" && other.kind === "lifetime"
          ? matchLifetime(argument.value, other.value)
          : argument.kind === "const" && other.kind === "const" &&
            matchConst(argument.value, other.value);
    });
  }

  function matchTrait(left: RustTraitRef, right: RustTraitRef): boolean {
    return rustSemanticIdentitiesEqual(left.identity, right.identity) &&
      matchArguments(left.arguments, right.arguments) &&
      closedMetadataEquals(left.associatedConstraints.map((constraint) =>
        constraint.kind === "equality"
          ? { ...constraint, type: substituteRustTargetGenerics(constraint.type, substitutions) }
          : { ...constraint, bounds: constraint.bounds.map((bound) => substituteRustBound(bound, substitutions)) }),
        right.associatedConstraints,
      );
  }

  function matchLifetime(left: RustLifetimeRef, right: RustLifetimeRef): boolean {
    const key = rustLifetimeSubstitutionKey(left);
    if (key !== undefined && parameters.lifetimes.has(key)) {
      const existing = substitutions.lifetimes.get(key);
      if (existing === undefined) {
        substitutions.lifetimes.set(key, right);
        return true;
      }
      return rustLifetimeSemanticKey(existing) === rustLifetimeSemanticKey(right);
    }
    return rustLifetimeSemanticKey(left) === rustLifetimeSemanticKey(right);
  }

  function matchConst(left: RustConstExpr, right: RustConstExpr): boolean {
    if (left.kind === "parameter") {
      const key = rustSemanticIdentityKey(left.identity);
      if (parameters.consts.has(key)) {
        const existing = substitutions.consts.get(key);
        if (existing === undefined) {
          substitutions.consts.set(key, right);
          return true;
        }
        return rustConstSemanticKey(existing) === rustConstSemanticKey(right);
      }
    }
    if (left.kind === "unary" && right.kind === "unary") {
      return left.operator === right.operator && matchConst(left.operand, right.operand);
    }
    if (left.kind === "binary" && right.kind === "binary") {
      return left.operator === right.operator && matchConst(left.left, right.left) &&
        matchConst(left.right, right.right);
    }
    return rustConstSemanticKey(left) === rustConstSemanticKey(right);
  }

  function mergeType(key: string, value: TargetTypeRef): boolean {
    const existing = substitutions.types.get(key);
    if (existing === undefined) {
      substitutions.types.set(key, value);
      return true;
    }
    return rustTargetTypeRefEquals(existing, value);
  }

  function mergeAssociatedType(key: string, value: TargetTypeRef): boolean {
    const existing = substitutions.associatedTypes.get(key);
    if (existing === undefined) {
      substitutions.associatedTypes.set(key, value);
      return true;
    }
    return rustTargetTypeRefEquals(existing, value);
  }

  function matchSourceCarrier(
    left: Extract<TargetTypeRef, { readonly kind: "source-carrier" }>,
    right: Extract<TargetTypeRef, { readonly kind: "source-carrier" }>,
  ): boolean {
    const leftSource = rustSourceTypeCarrierValue(left);
    const rightSource = rustSourceTypeCarrierValue(right);
    if (leftSource !== undefined || rightSource !== undefined) {
      return leftSource !== undefined && rightSource !== undefined &&
        leftSource.fileName === rightSource.fileName && leftSource.typeName === rightSource.typeName &&
        leftSource.shape === rightSource.shape &&
        matchArguments(leftSource.genericArguments, rightSource.genericArguments);
    }
    const leftObject = rustStructuralObjectCarrierValue(left);
    const rightObject = rustStructuralObjectCarrierValue(right);
    if (leftObject !== undefined || rightObject !== undefined) {
      return leftObject !== undefined && rightObject !== undefined &&
        leftObject.ownerFileName === rightObject.ownerFileName &&
        leftObject.fields.length === rightObject.fields.length &&
        leftObject.fields.every((field, index) => {
          const other = rightObject.fields[index];
          return other !== undefined && field.sourceName === other.sourceName &&
            field.presence === other.presence && field.readonly === other.readonly &&
            matchType(field.type, other.type);
        });
    }
    const leftUnion = rustSourceUnionCarrierValue(left);
    const rightUnion = rustSourceUnionCarrierValue(right);
    return leftUnion !== undefined && rightUnion !== undefined &&
      leftUnion.fileName === rightUnion.fileName && leftUnion.typeName === rightUnion.typeName &&
      leftUnion.variants.length === rightUnion.variants.length &&
      leftUnion.variants.every((variant, index) => {
        const other = rightUnion.variants[index];
        return other !== undefined && variant.name === other.name &&
          matchType(variant.carrier, other.carrier);
      });
  }
}

export function substituteRustTargetGenerics(
  type: TargetTypeRef,
  substitutions: RustGenericSubstitutions,
): TargetTypeRef {
  switch (type.kind) {
    case "type-parameter":
      return substitutions.types.get(rustSemanticIdentityKey(type.identity)) ?? type;
    case "path":
      return rustPathTargetType({
        ...type,
        arguments: type.arguments.map((argument) =>
          substituteRustGenericArgument(argument, substitutions)),
        traitImplementations: type.traitImplementations.map((implementation) => ({
          ...implementation,
          trait: substituteRustTraitRef(implementation.trait, substitutions),
          requirements: implementation.requirements.map((requirement) => ({
            ...requirement,
            trait: substituteRustTraitRef(requirement.trait, substitutions),
          })),
        })),
      });
    case "array":
      return {
        ...type,
        element: substituteRustTargetGenerics(type.element, substitutions),
        length: substituteRustConstExpression(type.length, substitutions),
      };
    case "sequence":
    case "slice":
      return { ...type, element: substituteRustTargetGenerics(type.element, substitutions) };
    case "tuple":
      return {
        ...type,
        elements: type.elements.map((element) =>
          substituteRustTargetGenerics(element, substitutions)),
      };
    case "reference":
      return {
        ...type,
        lifetime: substituteRustLifetime(type.lifetime, substitutions),
        target: substituteRustTargetGenerics(type.target, substitutions),
      };
    case "raw-pointer":
      return { ...type, target: substituteRustTargetGenerics(type.target, substitutions) };
    case "function-pointer":
      return {
        ...type,
        parameters: type.parameters.map((parameter) =>
          substituteRustTargetGenerics(parameter, substitutions)),
        result: substituteRustTargetGenerics(type.result, substitutions),
      };
    case "closure":
      return {
        ...type,
        parameters: type.parameters.map((parameter) =>
          substituteRustTargetGenerics(parameter, substitutions)),
        result: substituteRustTargetGenerics(type.result, substitutions),
        captures: type.captures.map((capture) =>
          substituteRustCapturedGeneric(capture, substitutions)),
      };
    case "trait-object":
      return {
        ...type,
        principal: substituteRustTraitRef(type.principal, substitutions),
        autoTraits: type.autoTraits.map((trait) =>
          substituteRustTraitRef(trait, substitutions)),
        lifetime: substituteRustLifetime(type.lifetime, substitutions),
      };
    case "opaque":
      return {
        ...type,
        bounds: type.bounds.map((bound) => substituteRustBound(bound, substitutions)),
        captures: type.captures.map((capture) =>
          substituteRustCapturedGeneric(capture, substitutions)),
      };
    case "associated-type":
      {
        const projection = substituteAssociatedProjectionShape(type, substitutions);
        return substitutions.associatedTypes.get(rustTypeSemanticKey(projection)) ?? projection;
      }
    case "source-carrier":
      return substituteSourceCarrier(type, substitutions);
    case "source-primitive":
    case "primitive":
    case "inference-variable":
    case "never":
    case "unit":
    case "str":
    case "self":
      return type;
  }
}

function substituteAssociatedProjectionShape(
  projection: Extract<TargetTypeRef, { readonly kind: "associated-type" }>,
  substitutions: RustGenericSubstitutions,
): Extract<TargetTypeRef, { readonly kind: "associated-type" }> {
  return Object.freeze({
    ...projection,
    owner: substituteRustTargetGenerics(projection.owner, substitutions),
    trait: substituteRustTraitRef(projection.trait, substitutions),
    arguments: Object.freeze(projection.arguments.map((argument) =>
      substituteRustGenericArgument(argument, substitutions))),
  });
}

export function substituteRustGenericArgument(
  argument: RustGenericArgument,
  substitutions: RustGenericSubstitutions,
): RustGenericArgument {
  switch (argument.kind) {
    case "lifetime":
      return { ...argument, value: substituteRustLifetime(argument.value, substitutions) };
    case "type":
      return { ...argument, value: substituteRustTargetGenerics(argument.value, substitutions) };
    case "const":
      return { ...argument, value: substituteRustConstExpression(argument.value, substitutions) };
  }
}

export function substituteRustLifetime(
  lifetime: RustLifetimeRef,
  substitutions: RustGenericSubstitutions,
): RustLifetimeRef {
  const key = rustLifetimeSubstitutionKey(lifetime);
  return key === undefined ? lifetime : substitutions.lifetimes.get(key) ?? lifetime;
}

function rustLifetimeSubstitutionKey(lifetime: RustLifetimeRef): string | undefined {
  return lifetime.kind === "parameter"
    ? rustSemanticIdentityKey(lifetime.identity)
    : lifetime.kind === "bound"
      ? rustLifetimeSemanticKey(lifetime)
      : undefined;
}

export function substituteRustConstExpression(
  expression: RustConstExpr,
  substitutions: RustGenericSubstitutions,
): RustConstExpr {
  switch (expression.kind) {
    case "parameter":
      return substitutions.consts.get(rustSemanticIdentityKey(expression.identity)) ?? expression;
    case "unary":
      return {
        ...expression,
        operand: substituteRustConstExpression(expression.operand, substitutions),
      };
    case "binary":
      return {
        ...expression,
        left: substituteRustConstExpression(expression.left, substitutions),
        right: substituteRustConstExpression(expression.right, substitutions),
      };
    case "literal":
    case "item":
    case "inferred":
      return expression;
  }
}

export function substituteRustTraitRef(
  trait: RustTraitRef,
  substitutions: RustGenericSubstitutions,
): RustTraitRef {
  return {
    ...trait,
    arguments: trait.arguments.map((argument) =>
      substituteRustGenericArgument(argument, substitutions)),
    associatedConstraints: trait.associatedConstraints.map((constraint) =>
      constraint.kind === "equality"
        ? {
            ...constraint,
            arguments: constraint.arguments.map((argument) =>
              substituteRustGenericArgument(argument, substitutions)),
            type: substituteRustTargetGenerics(constraint.type, substitutions),
          }
        : {
            ...constraint,
            arguments: constraint.arguments.map((argument) =>
              substituteRustGenericArgument(argument, substitutions)),
            bounds: constraint.bounds.map((bound) => substituteRustBound(bound, substitutions)),
          }),
  };
}

export function substituteRustBound(
  bound: RustBound,
  substitutions: RustGenericSubstitutions,
): RustBound {
  switch (bound.kind) {
    case "trait":
      return { ...bound, trait: substituteRustTraitRef(bound.trait, substitutions) };
    case "lifetime-outlives":
      return {
        ...bound,
        longer: substituteRustLifetime(bound.longer, substitutions),
        shorter: substituteRustLifetime(bound.shorter, substitutions),
      };
    case "type-outlives":
      return {
        ...bound,
        type: substituteRustTargetGenerics(bound.type, substitutions),
        lifetime: substituteRustLifetime(bound.lifetime, substitutions),
      };
    case "associated-equality":
      return {
        ...bound,
        projection: substituteAssociatedProjectionShape(bound.projection, substitutions),
        value: substituteRustTargetGenerics(bound.value, substitutions),
      };
    case "precise-capture":
      return {
        ...bound,
        captures: bound.captures.map((capture) =>
          substituteRustCapturedGeneric(capture, substitutions)),
      };
  }
}

export function substituteRustGenerics(
  generics: RustGenerics,
  substitutions: RustGenericSubstitutions,
  options: { readonly omitSubstitutedParameters?: boolean } = {},
): RustGenerics {
  const omit = options.omitSubstitutedParameters === true;
  const parameters = generics.parameters.flatMap((parameter): readonly RustGenericParameter[] => {
    const key = rustGenericParameterIdentityKey(parameter);
    const substituted = key !== undefined && (
      parameter.kind === "lifetime"
        ? substitutions.lifetimes.has(key)
        : parameter.kind === "type"
          ? substitutions.types.has(key)
          : substitutions.consts.has(key)
    );
    if (omit && substituted) return [];
    if (parameter.kind === "lifetime") {
      return [{
        ...parameter,
        bounds: parameter.bounds.map((bound) =>
          substituteRustLifetime(bound, substitutions)),
      }];
    }
    if (parameter.kind === "type") {
      return [{
        ...parameter,
        bounds: parameter.bounds.map((bound) => substituteRustBound(bound, substitutions)),
        ...(parameter.defaultType === undefined
          ? {}
          : { defaultType: substituteRustTargetGenerics(parameter.defaultType, substitutions) }),
      }];
    }
    return [{
      ...parameter,
      type: substituteRustTargetGenerics(parameter.type, substitutions),
      ...(parameter.defaultValue === undefined
        ? {}
        : { defaultValue: substituteRustConstExpression(parameter.defaultValue, substitutions) }),
    }];
  });
  const wherePredicates = generics.wherePredicates.map((predicate): RustWherePredicate => {
    if (predicate.kind === "lifetime") {
      return {
        ...predicate,
        lifetime: substituteRustLifetime(predicate.lifetime, substitutions),
        outlives: predicate.outlives.map((lifetime) =>
          substituteRustLifetime(lifetime, substitutions)),
      };
    }
    if (predicate.kind === "equality") {
      return {
        ...predicate,
        projection: substituteRustTargetGenerics(
          predicate.projection,
          substitutions,
        ) as Extract<TargetTypeRef, { readonly kind: "associated-type" }>,
        value: substituteRustTargetGenerics(predicate.value, substitutions),
      };
    }
    return {
      ...predicate,
      type: substituteRustTargetGenerics(predicate.type, substitutions),
      bounds: predicate.bounds.map((bound) => substituteRustBound(bound, substitutions)),
    };
  });
  return Object.freeze({
    parameters: Object.freeze(parameters),
    wherePredicates: Object.freeze(wherePredicates),
  });
}

function substituteRustCapturedGeneric(
  capture: RustCapturedGeneric,
  substitutions: RustGenericSubstitutions,
): RustCapturedGeneric {
  switch (capture.kind) {
    case "lifetime":
      return { ...capture, value: substituteRustLifetime(capture.value, substitutions) };
    case "type": {
      const replacement = substitutions.types.get(rustSemanticIdentityKey(capture.identity));
      return replacement?.kind === "type-parameter"
        ? { ...capture, identity: replacement.identity, displayName: replacement.displayName }
        : capture;
    }
    case "const": {
      const replacement = substitutions.consts.get(rustSemanticIdentityKey(capture.identity));
      return replacement?.kind === "parameter"
        ? { ...capture, identity: replacement.identity, displayName: replacement.displayName }
        : capture;
    }
  }
}

function substituteSourceCarrier(
  type: Extract<TargetTypeRef, { readonly kind: "source-carrier" }>,
  substitutions: RustGenericSubstitutions,
): TargetTypeRef {
  const sourceType = rustSourceTypeCarrierValue(type);
  if (sourceType !== undefined) {
    return rustSourceTypeCarrier(
      sourceType.fileName,
      sourceType.typeName,
      sourceType.shape,
      sourceType.genericArguments.map((argument) =>
        substituteRustGenericArgument(argument, substitutions)),
    );
  }
  const structuralObject = rustStructuralObjectCarrierValue(type);
  if (structuralObject !== undefined) {
    return rustStructuralObjectTargetType(
      structuralObject.ownerFileName,
      structuralObject.fields.map((field) => ({
        ...field,
        type: substituteRustTargetGenerics(field.type, substitutions),
      })),
    );
  }
  const sourceUnion = rustSourceUnionCarrierValue(type);
  if (sourceUnion !== undefined) {
    return rustSourceUnionTargetType(
      sourceUnion.fileName,
      sourceUnion.typeName,
      sourceUnion.variants.map((variant) => ({
        ...variant,
        carrier: substituteRustTargetGenerics(variant.carrier, substitutions),
      })),
    );
  }
  return type;
}

function collectTypeIdentities(type: TargetTypeRef, identities: Set<string>): void {
  switch (type.kind) {
    case "type-parameter":
      identities.add(rustSemanticIdentityKey(type.identity));
      return;
    case "path":
      type.arguments.forEach((argument) => collectArgumentIdentities(argument, identities));
      type.traitImplementations.forEach((implementation) => {
        collectTraitIdentities(implementation.trait, identities);
        implementation.requirements.forEach((requirement) =>
          collectTraitIdentities(requirement.trait, identities));
      });
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
      type.traitImplementations.forEach((implementation) => {
        collectTraitAssociatedProjections(implementation.trait, projections);
        implementation.requirements.forEach((requirement) =>
          collectTraitAssociatedProjections(requirement.trait, projections));
      });
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
    case "precise-capture":
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
    case "precise-capture":
      bound.captures.forEach((capture) => collectCaptureIdentities(capture, identities));
      return;
  }
}

function collectCaptureIdentities(capture: RustCapturedGeneric, identities: Set<string>): void {
  if (capture.kind === "lifetime") collectLifetimeIdentities(capture.value, identities);
  else identities.add(rustSemanticIdentityKey(capture.identity));
}
