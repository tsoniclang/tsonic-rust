import type {
  RustCompilerAssociatedConstraint,
  RustCompilerBound,
  RustCompilerConstExpression,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerGenerics,
  RustCompilerLifetime,
  RustCompilerTraitReference,
  RustCompilerType,
} from "../model.js";

export interface RustCompilerSubstitutions {
  readonly types: ReadonlyMap<string, RustCompilerType>;
  readonly lifetimes: ReadonlyMap<string, RustCompilerLifetime>;
  readonly consts: ReadonlyMap<string, RustCompilerConstExpression>;
}

export const emptyRustCompilerSubstitutions: RustCompilerSubstitutions = Object.freeze({
  types: new Map(),
  lifetimes: new Map(),
  consts: new Map(),
});

export function substituteRustCompilerGenerics(
  generics: RustCompilerGenerics,
  substitutions: RustCompilerSubstitutions,
): RustCompilerGenerics {
  return Object.freeze({
    parameters: Object.freeze(generics.parameters.map((parameter) =>
      substituteRustCompilerGenericParameter(parameter, substitutions))),
    wherePredicates: Object.freeze(generics.wherePredicates.map((predicate) => {
      if (predicate.kind === "lifetime") {
        return Object.freeze({
          ...predicate,
          lifetime: substituteRustCompilerLifetime(predicate.lifetime, substitutions),
          outlives: Object.freeze(predicate.outlives.map((lifetime) =>
            substituteRustCompilerLifetime(lifetime, substitutions))),
        });
      }
      if (predicate.kind === "equality") {
        const projection = substituteRustCompilerType(predicate.projection, substitutions);
        if (projection.kind !== "associated-type") {
          throw new Error("Rust generic equality substitution changed its projection kind.");
        }
        return Object.freeze({
          ...predicate,
          projection,
          value: substituteRustCompilerType(predicate.value, substitutions),
        });
      }
      return Object.freeze({
        ...predicate,
        type: substituteRustCompilerType(predicate.type, substitutions),
        bounds: Object.freeze(predicate.bounds.map((bound) =>
          substituteRustCompilerBound(bound, substitutions))),
      });
    })),
  });
}

function substituteRustCompilerGenericParameter(
  parameter: RustCompilerGenericParameter,
  substitutions: RustCompilerSubstitutions,
): RustCompilerGenericParameter {
  if (parameter.kind === "lifetime") {
    return Object.freeze({
      ...parameter,
      bounds: Object.freeze(parameter.bounds.map((lifetime) =>
        substituteRustCompilerLifetime(lifetime, substitutions))),
    });
  }
  if (parameter.kind === "type") {
    return Object.freeze({
      ...parameter,
      bounds: Object.freeze(parameter.bounds.map((bound) =>
        substituteRustCompilerBound(bound, substitutions))),
      ...(parameter.defaultType === undefined
        ? {}
        : { defaultType: substituteRustCompilerType(parameter.defaultType, substitutions) }),
    });
  }
  return Object.freeze({
    ...parameter,
    type: substituteRustCompilerType(parameter.type, substitutions),
    ...(parameter.defaultValue === undefined
      ? {}
        : { defaultValue: substituteRustCompilerConstExpression(parameter.defaultValue, substitutions) }),
  });
}

export function substituteRustCompilerType(
  type: RustCompilerType,
  substitutions: RustCompilerSubstitutions,
): RustCompilerType {
  switch (type.kind) {
    case "unit":
    case "never":
    case "primitive":
      return type;
    case "type-parameter":
      return substitutions.types.get(type.identity.itemId) ?? type;
    case "self":
      return substitutions.types.get(type.owner.itemId) ?? type;
    case "tuple":
      return Object.freeze({
        kind: "tuple",
        elements: Object.freeze(type.elements.map((element) => substituteRustCompilerType(element, substitutions))),
      });
    case "array":
      return Object.freeze({
        kind: "array",
        element: substituteRustCompilerType(type.element, substitutions),
        length: substituteRustCompilerConstExpression(type.length, substitutions),
      });
    case "slice":
      return Object.freeze({ kind: "slice", element: substituteRustCompilerType(type.element, substitutions) });
    case "reference":
      return Object.freeze({
        kind: "reference",
        mutable: type.mutable,
        lifetime: substituteRustCompilerLifetime(type.lifetime, substitutions),
        target: substituteRustCompilerType(type.target, substitutions),
      });
    case "raw-pointer":
      return Object.freeze({
        kind: "raw-pointer",
        mutable: type.mutable,
        target: substituteRustCompilerType(type.target, substitutions),
      });
    case "function-pointer":
      return Object.freeze({
        ...type,
        parameters: Object.freeze(type.parameters.map((parameter) => substituteRustCompilerType(parameter, substitutions))),
        result: substituteRustCompilerType(type.result, substitutions),
      });
    case "trait-object":
      return Object.freeze({
        kind: "trait-object",
        principal: substituteRustCompilerTrait(type.principal, substitutions),
        autoTraits: Object.freeze(type.autoTraits.map((trait) => substituteRustCompilerTrait(trait, substitutions))),
        lifetime: substituteRustCompilerLifetime(type.lifetime, substitutions),
      });
    case "opaque":
      return Object.freeze({
        ...type,
        bounds: Object.freeze(type.bounds.map((bound) => substituteRustCompilerBound(bound, substitutions))),
        captures: Object.freeze(type.captures.map((capture) => substituteRustCompilerArgument(capture, substitutions))),
      });
    case "associated-type":
      return Object.freeze({
        ...type,
        owner: substituteRustCompilerType(type.owner, substitutions),
        trait: substituteRustCompilerTrait(type.trait, substitutions),
        arguments: Object.freeze(type.arguments.map((argument) => substituteRustCompilerArgument(argument, substitutions))),
      });
    case "path":
      return Object.freeze({
        ...type,
        arguments: Object.freeze(type.arguments.map((argument) => substituteRustCompilerArgument(argument, substitutions))),
      });
  }
}

export function substituteRustCompilerArgument(
  argument: RustCompilerGenericArgument,
  substitutions: RustCompilerSubstitutions,
): RustCompilerGenericArgument {
  switch (argument.kind) {
    case "lifetime":
      return Object.freeze({ kind: "lifetime", value: substituteRustCompilerLifetime(argument.value, substitutions) });
    case "type":
      return Object.freeze({ kind: "type", value: substituteRustCompilerType(argument.value, substitutions) });
    case "const":
      return Object.freeze({ kind: "const", value: substituteRustCompilerConstExpression(argument.value, substitutions) });
  }
}

export function rustCompilerTypeArguments(
  arguments_: readonly RustCompilerGenericArgument[],
): readonly RustCompilerType[] {
  return Object.freeze(arguments_.flatMap((argument) => argument.kind === "type" ? [argument.value] : []));
}

export function rustStaticValueCanBeCopied(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "unit":
    case "never":
    case "primitive":
    case "raw-pointer":
    case "function-pointer":
      return type.kind !== "primitive" || type.name !== "str";
    case "tuple":
      return type.elements.every(rustStaticValueCanBeCopied);
    case "array":
      return rustStaticValueCanBeCopied(type.element);
    case "reference":
      return !type.mutable;
    case "type-parameter":
    case "self":
    case "associated-type":
    case "trait-object":
    case "opaque":
    case "slice":
    case "path":
      return false;
  }
}

export function rustCompilerTypeSemanticKey(type: RustCompilerType): string {
  switch (type.kind) {
    case "unit":
    case "never":
      return type.kind;
    case "primitive":
      return `primitive:${field(type.name)}`;
    case "type-parameter":
      return `parameter:${field(type.identity.itemId)}`;
    case "self":
      return `self:${field(type.owner.itemId)}`;
    case "tuple":
      return `tuple:${list(type.elements.map(rustCompilerTypeSemanticKey))}`;
    case "array":
      return `array:${field(rustCompilerTypeSemanticKey(type.element))}:${field(rustCompilerConstSemanticKey(type.length))}`;
    case "slice":
      return `slice:${field(rustCompilerTypeSemanticKey(type.element))}`;
    case "reference":
      return `reference:${type.mutable ? "mut" : "shared"}:${field(rustCompilerLifetimeSemanticKey(type.lifetime))}:${field(rustCompilerTypeSemanticKey(type.target))}`;
    case "raw-pointer":
      return `raw:${type.mutable ? "mut" : "const"}:${field(rustCompilerTypeSemanticKey(type.target))}`;
    case "function-pointer":
      return `fn:${type.safety}:${field(type.abi)}:${type.variadic ? "variadic" : "fixed"}:${field(rustCompilerBinderSemanticKey(type.binder))}:${list(type.parameters.map(rustCompilerTypeSemanticKey))}:${field(rustCompilerTypeSemanticKey(type.result))}`;
    case "trait-object":
      return `dyn:${field(rustCompilerTraitSemanticKey(type.principal))}:${list(type.autoTraits.map(rustCompilerTraitSemanticKey))}:${field(rustCompilerLifetimeSemanticKey(type.lifetime))}`;
    case "opaque":
      return `opaque:${field(type.identity.itemId)}:${list(type.bounds.map(rustCompilerBoundSemanticKey))}:${list(type.captures.map(rustCompilerArgumentSemanticKey))}`;
    case "associated-type":
      return `associated:${field(rustCompilerTypeSemanticKey(type.owner))}:${field(rustCompilerTraitSemanticKey(type.trait))}:${field(type.item.itemId)}:${list(type.arguments.map(rustCompilerArgumentSemanticKey))}`;
    case "path":
      return `path:${field(type.identity.itemId)}:${list(type.arguments.map(rustCompilerArgumentSemanticKey))}`;
  }
}

export function rustCompilerTypesEqual(left: RustCompilerType, right: RustCompilerType): boolean {
  return rustCompilerTypeSemanticKey(left) === rustCompilerTypeSemanticKey(right);
}

export function rustCompilerTraitSemanticKey(trait: RustCompilerTraitReference): string {
  return `trait:${field(trait.identity.itemId)}:${list(trait.arguments.map(rustCompilerArgumentSemanticKey))}:${list(trait.associatedConstraints.map(rustCompilerConstraintSemanticKey))}`;
}

function substituteRustCompilerLifetime(
  lifetime: RustCompilerLifetime,
  substitutions: RustCompilerSubstitutions,
): RustCompilerLifetime {
  return lifetime.kind === "parameter"
    ? substitutions.lifetimes.get(lifetime.identity.itemId) ?? lifetime
    : lifetime;
}

export function substituteRustCompilerConstExpression(
  expression: RustCompilerConstExpression,
  substitutions: RustCompilerSubstitutions,
): RustCompilerConstExpression {
  switch (expression.kind) {
    case "literal":
    case "inferred":
      return expression;
    case "parameter":
      return substitutions.consts.get(expression.identity.itemId) ?? expression;
    case "item":
      return expression;
    case "unary":
      return Object.freeze({
        ...expression,
        operand: substituteRustCompilerConstExpression(expression.operand, substitutions),
      });
    case "binary":
      return Object.freeze({
        ...expression,
        left: substituteRustCompilerConstExpression(expression.left, substitutions),
        right: substituteRustCompilerConstExpression(expression.right, substitutions),
      });
  }
}

export function substituteRustCompilerTrait(
  trait: RustCompilerTraitReference,
  substitutions: RustCompilerSubstitutions,
): RustCompilerTraitReference {
  return Object.freeze({
    ...trait,
    arguments: Object.freeze(trait.arguments.map((argument) => substituteRustCompilerArgument(argument, substitutions))),
    associatedConstraints: Object.freeze(trait.associatedConstraints.map((constraint) =>
      substituteRustCompilerConstraint(constraint, substitutions))),
  });
}

function substituteRustCompilerConstraint(
  constraint: RustCompilerAssociatedConstraint,
  substitutions: RustCompilerSubstitutions,
): RustCompilerAssociatedConstraint {
  return constraint.kind === "equality"
    ? Object.freeze({
        ...constraint,
        arguments: Object.freeze(constraint.arguments.map((argument) => substituteRustCompilerArgument(argument, substitutions))),
        type: substituteRustCompilerType(constraint.type, substitutions),
      })
    : Object.freeze({
        ...constraint,
        arguments: Object.freeze(constraint.arguments.map((argument) => substituteRustCompilerArgument(argument, substitutions))),
        bounds: Object.freeze(constraint.bounds.map((bound) => substituteRustCompilerBound(bound, substitutions))),
      });
}

export function substituteRustCompilerBound(
  bound: RustCompilerBound,
  substitutions: RustCompilerSubstitutions,
): RustCompilerBound {
  switch (bound.kind) {
    case "trait":
      return Object.freeze({ ...bound, trait: substituteRustCompilerTrait(bound.trait, substitutions) });
    case "lifetime-outlives":
      return Object.freeze({
        ...bound,
        longer: substituteRustCompilerLifetime(bound.longer, substitutions),
        shorter: substituteRustCompilerLifetime(bound.shorter, substitutions),
      });
    case "type-outlives":
      return Object.freeze({
        ...bound,
        type: substituteRustCompilerType(bound.type, substitutions),
        lifetime: substituteRustCompilerLifetime(bound.lifetime, substitutions),
      });
    case "associated-equality": {
      const projection = substituteRustCompilerType(bound.projection, substitutions);
      if (projection.kind !== "associated-type") throw new Error("Rust associated projection substitution changed its kind.");
      return Object.freeze({
        ...bound,
        projection,
        value: substituteRustCompilerType(bound.value, substitutions),
      });
    }
    case "precise-capture":
      return Object.freeze({
        ...bound,
        captures: Object.freeze(bound.captures.map((capture) => substituteRustCompilerArgument(capture, substitutions))),
      });
  }
}

export function rustCompilerLifetimeSemanticKey(lifetime: RustCompilerLifetime): string {
  switch (lifetime.kind) {
    case "static": return "static";
    case "parameter": return `parameter:${field(lifetime.identity.itemId)}`;
    case "bound": return `bound:${field(lifetime.binderId)}:${field(lifetime.parameterId)}`;
    case "elided": return `elided:${field(lifetime.ownerId)}:${field(lifetime.position)}`;
  }
}

export function rustCompilerConstSemanticKey(expression: RustCompilerConstExpression): string {
  switch (expression.kind) {
    case "literal": return `literal:${expression.literalKind}:${field(String(expression.value))}`;
    case "parameter": return `parameter:${field(expression.identity.itemId)}`;
    case "item": return `item:${field(expression.identity.itemId)}`;
    case "inferred": return "inferred";
    case "unary": return `unary:${expression.operator}:${field(rustCompilerConstSemanticKey(expression.operand))}`;
    case "binary": return `binary:${expression.operator}:${field(rustCompilerConstSemanticKey(expression.left))}:${field(rustCompilerConstSemanticKey(expression.right))}`;
  }
}

export function rustCompilerArgumentSemanticKey(argument: RustCompilerGenericArgument): string {
  switch (argument.kind) {
    case "lifetime": return `lifetime:${field(rustCompilerLifetimeSemanticKey(argument.value))}`;
    case "type": return `type:${field(rustCompilerTypeSemanticKey(argument.value))}`;
    case "const": return `const:${field(rustCompilerConstSemanticKey(argument.value))}`;
  }
}

function rustCompilerConstraintSemanticKey(constraint: RustCompilerAssociatedConstraint): string {
  return constraint.kind === "equality"
    ? `equality:${field(constraint.item.itemId)}:${list(constraint.arguments.map(rustCompilerArgumentSemanticKey))}:${field(rustCompilerTypeSemanticKey(constraint.type))}`
    : `bounds:${field(constraint.item.itemId)}:${list(constraint.arguments.map(rustCompilerArgumentSemanticKey))}:${list(constraint.bounds.map(rustCompilerBoundSemanticKey))}`;
}

export function rustCompilerBoundSemanticKey(bound: RustCompilerBound): string {
  switch (bound.kind) {
    case "trait": return `trait:${bound.polarity}:${field(rustCompilerBinderSemanticKey(bound.binder))}:${field(rustCompilerTraitSemanticKey(bound.trait))}`;
    case "lifetime-outlives": return `outlives:${field(rustCompilerLifetimeSemanticKey(bound.longer))}:${field(rustCompilerLifetimeSemanticKey(bound.shorter))}`;
    case "type-outlives": return `valid-for:${field(rustCompilerTypeSemanticKey(bound.type))}:${field(rustCompilerLifetimeSemanticKey(bound.lifetime))}`;
    case "associated-equality": return `associated:${field(rustCompilerTypeSemanticKey(bound.projection))}:${field(rustCompilerTypeSemanticKey(bound.value))}`;
    case "precise-capture": return `capture:${list(bound.captures.map(rustCompilerArgumentSemanticKey))}`;
  }
}

function rustCompilerBinderSemanticKey(
  binder: import("../model.js").RustCompilerBinder | undefined,
): string {
  return binder === undefined
    ? "none"
    : `binder:${field(binder.id)}:${list(binder.lifetimes.map((parameter) =>
        `${field(rustCompilerLifetimeSemanticKey(parameter.identity))}:${list(
          parameter.bounds.map(rustCompilerLifetimeSemanticKey),
        )}`,
      ))}`;
}

function list(values: readonly string[]): string {
  return values.map(field).join(":");
}

function field(value: string): string {
  return `${value.length}:${value}`;
}
