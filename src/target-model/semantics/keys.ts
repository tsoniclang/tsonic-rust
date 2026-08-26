import type { RustBound, RustWherePredicate } from "./bounds.js";
import type { RustConstExpr } from "./const-expressions.js";
import type {
  RustBinder,
  RustCapturedGeneric,
  RustGenericArgument,
  RustGenericParameter,
  RustGenerics,
} from "./generics.js";
import { rustSemanticIdentityKey } from "./identity.js";
import type { RustLifetimeRef } from "./lifetimes.js";
import type { RustTraitRef, RustTypeRef } from "./types.js";
import { closedMetadataKey } from "../metadata/closed-data.js";

export function compareRustSemanticKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rustLifetimeSemanticKey(lifetime: RustLifetimeRef): string {
  switch (lifetime.kind) {
    case "static":
      return "lifetime:static";
    case "parameter":
      return `lifetime:parameter:${rustSemanticIdentityKey(lifetime.identity)}`;
    case "bound":
      return `lifetime:bound:${field(lifetime.binderId)}:${field(lifetime.parameterId)}`;
    case "inferred-region":
      return `lifetime:inferred:${field(lifetime.regionId)}`;
  }
}

export function rustConstSemanticKey(expression: RustConstExpr): string {
  switch (expression.kind) {
    case "literal":
      return `const:literal:${expression.literalKind}:${field(String(expression.value))}`;
    case "parameter":
      return `const:parameter:${rustSemanticIdentityKey(expression.identity)}`;
    case "item":
      return `const:item:${rustSemanticIdentityKey(expression.identity)}`;
    case "unary":
      return `const:unary:${expression.operator}:${field(rustConstSemanticKey(expression.operand))}`;
    case "binary":
      return `const:binary:${expression.operator}:${field(rustConstSemanticKey(expression.left))}:${field(rustConstSemanticKey(expression.right))}`;
    case "inferred":
      return "const:inferred";
  }
}

export function rustGenericArgumentSemanticKey(argument: RustGenericArgument): string {
  switch (argument.kind) {
    case "lifetime":
      return rustLifetimeSemanticKey(argument.value);
    case "type":
      return rustTypeSemanticKey(argument.value);
    case "const":
      return rustConstSemanticKey(argument.value);
  }
}

export function rustGenericParameterSemanticKey(parameter: RustGenericParameter): string {
  switch (parameter.kind) {
    case "lifetime":
      return `generic:lifetime:${field(rustLifetimeSemanticKey(parameter.identity))}:${list(
        parameter.bounds.map(rustLifetimeSemanticKey),
      )}`;
    case "type":
      return `generic:type:${field(rustSemanticIdentityKey(parameter.identity))}:${field(
        list(parameter.bounds.map(rustBoundSemanticKey)),
      )}:${field(
        parameter.defaultType === undefined ? "" : rustTypeSemanticKey(parameter.defaultType),
      )}`;
    case "const":
      return `generic:const:${field(rustSemanticIdentityKey(parameter.identity))}:${field(
        rustTypeSemanticKey(parameter.type),
      )}:${field(
        parameter.defaultValue === undefined ? "" : rustConstSemanticKey(parameter.defaultValue),
      )}`;
  }
}

export function rustGenericsSemanticKey(generics: RustGenerics): string {
  return `generics:${list(generics.parameters.map(rustGenericParameterSemanticKey))}:${list(
    generics.wherePredicates.map(rustWherePredicateSemanticKey),
  )}`;
}

export function rustTraitSemanticKey(trait: RustTraitRef): string {
  return `trait:${field(rustSemanticIdentityKey(trait.identity))}:${list(
    trait.arguments.map(rustGenericArgumentSemanticKey),
  )}:${list(trait.associatedConstraints.map((constraint) =>
    constraint.kind === "equality"
      ? `eq:${field(rustSemanticIdentityKey(constraint.item))}:${list(
          constraint.arguments.map(rustGenericArgumentSemanticKey),
        )}:${field(rustTypeSemanticKey(constraint.type))}`
      : `bounds:${field(rustSemanticIdentityKey(constraint.item))}:${list(
          constraint.arguments.map(rustGenericArgumentSemanticKey),
        )}:${list(constraint.bounds.map(rustBoundSemanticKey))}`,
  ))}`;
}

export function rustTypeSemanticKey(type: RustTypeRef): string {
  switch (type.kind) {
    case "source-primitive":
    case "primitive":
      return `type:${type.kind}:${type.name}`;
    case "never":
    case "unit":
    case "str":
      return `type:${type.kind}`;
    case "self":
      return `type:self:${rustSemanticIdentityKey(type.owner)}`;
    case "type-parameter":
    case "inference-variable":
      return `type:${type.kind}:${rustSemanticIdentityKey(type.identity)}`;
    case "tuple":
      return `type:tuple:${list(type.elements.map(rustTypeSemanticKey))}`;
    case "array":
      return `type:array:${field(rustTypeSemanticKey(type.element))}:${field(rustConstSemanticKey(type.length))}`;
    case "sequence":
    case "slice":
      return `type:${type.kind}:${field(rustTypeSemanticKey(type.element))}`;
    case "path":
      return `type:path:${field(rustSemanticIdentityKey(type.identity))}:${list(
        type.arguments.map(rustGenericArgumentSemanticKey),
      )}`;
    case "reference":
      return `type:reference:${type.mutable ? "mut" : "shared"}:${field(
        rustLifetimeSemanticKey(type.lifetime),
      )}:${field(rustTypeSemanticKey(type.target))}`;
    case "raw-pointer":
      return `type:raw-pointer:${type.mutable ? "mut" : "const"}:${field(rustTypeSemanticKey(type.target))}`;
    case "function-pointer":
      return `type:function-pointer:${type.safety}:${type.abi}:${type.variadic ? "variadic" : "fixed"}:${field(
        rustBinderSemanticKey(type.binder),
      )}:${list(type.parameters.map(rustTypeSemanticKey))}:${field(rustTypeSemanticKey(type.result))}`;
    case "closure":
      return `type:closure:${field(rustBinderSemanticKey(type.binder))}:${type.callTrait}:${list(type.parameters.map(rustTypeSemanticKey))}:${field(
        rustTypeSemanticKey(type.result),
      )}:${list(type.captures.map(rustCapturedGenericSemanticKey))}`;
    case "trait-object":
      return `type:trait-object:${field(rustTraitSemanticKey(type.principal))}:${list(
        type.autoTraits.map(rustTraitSemanticKey),
      )}:${field(rustLifetimeSemanticKey(type.lifetime))}`;
    case "opaque":
      return `type:opaque:${field(rustSemanticIdentityKey(type.identity))}:${list(
        type.bounds.map(rustBoundSemanticKey),
      )}:${list(type.captures.map(rustCapturedGenericSemanticKey))}`;
    case "associated-type":
      return `type:associated:${field(rustTypeSemanticKey(type.owner))}:${field(
        rustTraitSemanticKey(type.trait),
      )}:${field(rustSemanticIdentityKey(type.item))}:${list(
        type.arguments.map(rustGenericArgumentSemanticKey),
      )}`;
    case "source-carrier":
      return `type:source-carrier:${field(rustSemanticIdentityKey(type.identity))}:${field(
        closedMetadataKey(type.payload),
      )}`;
  }
}

export function rustBoundSemanticKey(bound: RustBound): string {
  switch (bound.kind) {
    case "trait":
      return `bound:trait:${bound.polarity}:${field(rustBinderSemanticKey(bound.binder))}:${field(rustTraitSemanticKey(bound.trait))}`;
    case "lifetime-outlives":
      return `bound:lifetime:${field(rustLifetimeSemanticKey(bound.longer))}:${field(rustLifetimeSemanticKey(bound.shorter))}`;
    case "type-outlives":
      return `bound:type:${field(rustTypeSemanticKey(bound.type))}:${field(rustLifetimeSemanticKey(bound.lifetime))}`;
    case "associated-equality":
      return `bound:associated:${field(rustTypeSemanticKey(bound.projection))}:${field(rustTypeSemanticKey(bound.value))}`;
  }
}

export function rustWherePredicateSemanticKey(predicate: RustWherePredicate): string {
  switch (predicate.kind) {
    case "type":
      return `where:type:${field(rustBinderSemanticKey(predicate.binder))}:${field(
        rustTypeSemanticKey(predicate.type),
      )}:${list(predicate.bounds.map(rustBoundSemanticKey))}`;
    case "lifetime":
      return `where:lifetime:${field(rustLifetimeSemanticKey(predicate.lifetime))}:${list(
        predicate.outlives.map(rustLifetimeSemanticKey),
      )}`;
    case "equality":
      return `where:equality:${field(rustTypeSemanticKey(predicate.projection))}:${field(
        rustTypeSemanticKey(predicate.value),
      )}`;
  }
}

export function rustBinderSemanticKey(binder: RustBinder | undefined): string {
  return binder === undefined
    ? "none"
    : `binder:${field(binder.id)}:${list(binder.lifetimes.map((parameter) =>
        `${field(rustLifetimeSemanticKey(parameter.identity))}:${list(
          parameter.bounds.map(rustLifetimeSemanticKey),
        )}`,
      ))}`;
}

export function rustCapturedGenericSemanticKey(capture: RustCapturedGeneric): string {
  return capture.kind === "lifetime"
    ? rustLifetimeSemanticKey(capture.value)
    : `${capture.kind}:${rustSemanticIdentityKey(capture.identity)}`;
}

export function compareRustCapturedGenerics(
  left: RustCapturedGeneric,
  right: RustCapturedGeneric,
): number {
  const leftRank = rustCapturedGenericRank(left);
  const rightRank = rustCapturedGenericRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftKey = rustCapturedGenericSemanticKey(left);
  const rightKey = rustCapturedGenericSemanticKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function rustCapturedGenericRank(capture: RustCapturedGeneric): number {
  return capture.kind === "lifetime" ? 0 : capture.kind === "type" ? 1 : 2;
}

function list(entries: readonly string[]): string {
  return entries.map(field).join(":");
}

function field(value: string): string {
  return `${value.length}:${value}`;
}
