import type {
  RustCompilerAssociatedConstraint,
  RustCompilerConstArgument,
  RustCompilerGenericArgument,
  RustCompilerGenericParameter,
  RustCompilerLifetime,
  RustCompilerLifetimeBinder,
  RustCompilerTraitDispatch,
  RustCompilerType,
  RustCompilerTypeRequirement,
} from "../model.js";

export interface RustCompilerSubstitutions {
  readonly types: ReadonlyMap<string, RustCompilerType>;
  readonly lifetimes: ReadonlyMap<string, RustCompilerLifetime>;
  readonly consts: ReadonlyMap<string, RustCompilerConstArgument>;
}

export const emptyRustCompilerSubstitutions: RustCompilerSubstitutions = Object.freeze({
  types: new Map(),
  lifetimes: new Map(),
  consts: new Map(),
});

export function createRustCompilerSubstitutions(
  parameters: readonly RustCompilerGenericParameter[],
  arguments_: readonly RustCompilerGenericArgument[],
): RustCompilerSubstitutions {
  if (arguments_.length > parameters.length) {
    throw new Error("Rust generic application supplies more arguments than its exact declaration.");
  }
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, RustCompilerLifetime>();
  const consts = new Map<string, RustCompilerConstArgument>();
  const substitutions: RustCompilerSubstitutions = { types, lifetimes, consts };
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]!;
    const argument = arguments_[index];
    if (argument !== undefined && argument.kind !== parameter.kind) {
      throw new Error(`Rust generic argument ${index} does not match its declaration kind.`);
    }
    if (parameter.kind === "lifetime") {
      if (argument?.kind !== "lifetime" || parameter.lifetime.kind !== "parameter") {
        throw new Error(`Rust lifetime parameter ${index} has no exact argument.`);
      }
      lifetimes.set(parameter.lifetime.identity.itemId, argument.lifetime);
      continue;
    }
    if (parameter.kind === "type") {
      const value = argument?.kind === "type"
        ? argument.type
        : parameter.defaultType === undefined
          ? undefined
          : substituteRustCompilerType(parameter.defaultType, substitutions);
      if (value === undefined) {
        throw new Error(`Rust type parameter '${parameter.name}' has no exact argument.`);
      }
      types.set(parameter.identity.itemId, value);
      continue;
    }
    const value = argument?.kind === "const"
      ? argument.value
      : parameter.defaultValue === undefined
        ? undefined
        : substituteRustCompilerConstArgument(parameter.defaultValue, substitutions);
    if (value === undefined) {
      throw new Error(`Rust const parameter '${parameter.name}' has no exact argument.`);
    }
    consts.set(parameter.identity.itemId, value);
  }
  return Object.freeze(substitutions);
}

export function substituteRustCompilerType(
  type: RustCompilerType,
  substitutions: RustCompilerSubstitutions,
): RustCompilerType {
  switch (type.kind) {
    case "unit":
    case "primitive":
      return type;
    case "generic":
      return substitutions.types.get(type.identity.itemId) ?? type;
    case "self":
      return substitutions.types.get(type.owner.itemId) ?? type;
    case "tuple":
      return Object.freeze({
        kind: "tuple",
        elements: Object.freeze(type.elements.map((element) =>
          substituteRustCompilerType(element, substitutions))),
      });
    case "array":
      return Object.freeze({
        kind: "array",
        element: substituteRustCompilerType(type.element, substitutions),
        length: substituteRustCompilerConstArgument(type.length, substitutions),
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
        ...(type.lifetimeBinder === undefined
          ? {}
          : { lifetimeBinder: substituteRustCompilerBinder(type.lifetimeBinder, substitutions) }),
        parameters: Object.freeze(type.parameters.map((parameter) =>
          substituteRustCompilerType(parameter, substitutions))),
        result: substituteRustCompilerType(type.result, substitutions),
      });
    case "trait-object":
      return Object.freeze({
        kind: "trait-object",
        principal: substituteRustCompilerTrait(type.principal, substitutions),
        autoTraits: Object.freeze(type.autoTraits.map((trait) =>
          substituteRustCompilerTrait(trait, substitutions))),
        lifetime: substituteRustCompilerLifetime(type.lifetime, substitutions),
      });
    case "opaque":
      return Object.freeze({
        ...type,
        bounds: Object.freeze(type.bounds.map((bound) => substituteRustCompilerTrait(bound, substitutions))),
        outlives: Object.freeze(type.outlives.map((lifetime) =>
          substituteRustCompilerLifetime(lifetime, substitutions))),
        captures: Object.freeze(type.captures.map((capture) =>
          substituteRustCompilerArgument(capture, substitutions))),
      });
    case "associated-type":
      return Object.freeze({
        ...type,
        owner: substituteRustCompilerType(type.owner, substitutions),
        trait: substituteRustCompilerTrait(type.trait, substitutions),
        genericArguments: Object.freeze(type.genericArguments.map((argument) =>
          substituteRustCompilerArgument(argument, substitutions))),
      });
    case "path":
      return Object.freeze({
        ...type,
        genericArguments: Object.freeze(type.genericArguments.map((argument) =>
          substituteRustCompilerArgument(argument, substitutions))),
      });
  }
}

export function substituteRustCompilerArgument(
  argument: RustCompilerGenericArgument,
  substitutions: RustCompilerSubstitutions,
): RustCompilerGenericArgument {
  switch (argument.kind) {
    case "lifetime":
      return Object.freeze({
        kind: "lifetime",
        lifetime: substituteRustCompilerLifetime(argument.lifetime, substitutions),
      });
    case "type":
      return Object.freeze({ kind: "type", type: substituteRustCompilerType(argument.type, substitutions) });
    case "const":
      return Object.freeze({
        kind: "const",
        value: substituteRustCompilerConstArgument(argument.value, substitutions),
      });
  }
}

export function substituteRustCompilerTrait(
  trait: RustCompilerTraitDispatch,
  substitutions: RustCompilerSubstitutions,
): RustCompilerTraitDispatch {
  return Object.freeze({
    ...trait,
    ...(trait.lifetimeBinder === undefined
      ? {}
      : { lifetimeBinder: substituteRustCompilerBinder(trait.lifetimeBinder, substitutions) }),
    genericArguments: Object.freeze(trait.genericArguments.map((argument) =>
      substituteRustCompilerArgument(argument, substitutions))),
    associatedConstraints: Object.freeze(trait.associatedConstraints.map((constraint) =>
      substituteAssociatedConstraint(constraint, substitutions))),
  });
}

export function rustStaticValueCanBeCopied(type: RustCompilerType): boolean {
  switch (type.kind) {
    case "unit":
    case "raw-pointer":
    case "function-pointer":
      return true;
    case "primitive":
      return type.name !== "str";
    case "tuple":
      return type.elements.every(rustStaticValueCanBeCopied);
    case "array":
      return rustStaticValueCanBeCopied(type.element);
    case "reference":
      return !type.mutable;
    case "generic":
    case "self":
    case "associated-type":
    case "trait-object":
    case "opaque":
    case "slice":
    case "path":
      return false;
  }
}

export function typeRequirementKey(requirement: RustCompilerTypeRequirement): string {
  return typeof requirement === "string"
    ? requirement
    : `trait:${rustCompilerTraitSemanticKey(requirement.trait)}`;
}

export function rustCompilerTypeSemanticKey(type: RustCompilerType): string {
  return typeSemanticKey(type, new Map());
}

export function rustCompilerTraitSemanticKey(trait: RustCompilerTraitDispatch): string {
  return traitSemanticKey(trait, new Map());
}

export function rustCompilerLifetimeSemanticKey(lifetime: RustCompilerLifetime): string {
  return lifetimeSemanticKey(lifetime, new Map());
}

function substituteRustCompilerLifetime(
  lifetime: RustCompilerLifetime,
  substitutions: RustCompilerSubstitutions,
): RustCompilerLifetime {
  return lifetime.kind === "parameter"
    ? substitutions.lifetimes.get(lifetime.identity.itemId) ?? lifetime
    : lifetime;
}

function substituteRustCompilerConstArgument(
  value: RustCompilerConstArgument,
  substitutions: RustCompilerSubstitutions,
): RustCompilerConstArgument {
  return value.kind === "parameter"
    ? substitutions.consts.get(value.identity.itemId) ?? value
    : value;
}

function substituteRustCompilerBinder(
  binder: RustCompilerLifetimeBinder,
  substitutions: RustCompilerSubstitutions,
): RustCompilerLifetimeBinder {
  return Object.freeze({
    ...binder,
    parameters: Object.freeze(binder.parameters.map((parameter) => Object.freeze({
      ...parameter,
      outlives: Object.freeze(parameter.outlives.map((lifetime) =>
        substituteRustCompilerLifetime(lifetime, substitutions))),
    }))),
  });
}

function substituteAssociatedConstraint(
  constraint: RustCompilerAssociatedConstraint,
  substitutions: RustCompilerSubstitutions,
): RustCompilerAssociatedConstraint {
  const genericArguments = Object.freeze(constraint.genericArguments.map((argument) =>
    substituteRustCompilerArgument(argument, substitutions)));
  return constraint.kind === "equality"
    ? Object.freeze({
        ...constraint,
        genericArguments,
        type: substituteRustCompilerType(constraint.type, substitutions),
      })
    : Object.freeze({
        ...constraint,
        genericArguments,
        traits: Object.freeze(constraint.traits.map((trait) =>
          substituteRustCompilerTrait(trait, substitutions))),
        outlives: Object.freeze(constraint.outlives.map((lifetime) =>
          substituteRustCompilerLifetime(lifetime, substitutions))),
      });
}

function typeSemanticKey(type: RustCompilerType, boundNames: ReadonlyMap<string, string>): string {
  switch (type.kind) {
    case "unit": return "unit";
    case "primitive": return `primitive:${field(type.name)}`;
    case "generic": return `generic:${field(type.identity.itemId)}`;
    case "self": return `self:${field(type.owner.itemId)}`;
    case "tuple": return `tuple:${list(type.elements.map((element) => typeSemanticKey(element, boundNames)))}`;
    case "array": return `array:${field(typeSemanticKey(type.element, boundNames))}:${field(constSemanticKey(type.length))}`;
    case "slice": return `slice:${field(typeSemanticKey(type.element, boundNames))}`;
    case "reference": return `reference:${type.mutable ? "mutable" : "shared"}:${field(lifetimeSemanticKey(type.lifetime, boundNames))}:${field(typeSemanticKey(type.target, boundNames))}`;
    case "raw-pointer": return `pointer:${type.mutable ? "mutable" : "const"}:${field(typeSemanticKey(type.target, boundNames))}`;
    case "function-pointer": {
      const binder = binderSemanticContext(type.lifetimeBinder, boundNames);
      return `function:${field(type.abi)}:${type.unsafe ? "unsafe" : "safe"}:${field(binder.key)}:${list(type.parameters.map((parameter) => typeSemanticKey(parameter, binder.names)))}:${field(typeSemanticKey(type.result, binder.names))}`;
    }
    case "trait-object": return `dynamic:${field(traitSemanticKey(type.principal, boundNames))}:${list(type.autoTraits.map((trait) => traitSemanticKey(trait, boundNames)))}:${field(lifetimeSemanticKey(type.lifetime, boundNames))}`;
    case "opaque": return `opaque:${field(type.identity.itemId)}:${list(type.bounds.map((bound) => traitSemanticKey(bound, boundNames)))}:${list(type.outlives.map((lifetime) => lifetimeSemanticKey(lifetime, boundNames)))}:${list(type.captures.map((capture) => rustCompilerGenericArgumentSemanticKey(capture, boundNames)))}`;
    case "associated-type": return `associated:${field(type.identity.itemId)}:${field(typeSemanticKey(type.owner, boundNames))}:${field(traitSemanticKey(type.trait, boundNames))}:${list(type.genericArguments.map((argument) => rustCompilerGenericArgumentSemanticKey(argument, boundNames)))}:${type.maybeSized ? "maybe-sized" : "sized"}`;
    case "path": return `path:${field(type.identity.itemId)}:${list(type.genericArguments.map((argument) => rustCompilerGenericArgumentSemanticKey(argument, boundNames)))}`;
  }
}

function traitSemanticKey(
  trait: RustCompilerTraitDispatch,
  outerNames: ReadonlyMap<string, string>,
): string {
  const binder = binderSemanticContext(trait.lifetimeBinder, outerNames);
  return `${field(trait.identity.itemId)}:${field(binder.key)}:${list(trait.genericArguments.map((argument) => rustCompilerGenericArgumentSemanticKey(argument, binder.names)))}:${list(trait.associatedConstraints.map((constraint) => associatedConstraintSemanticKey(constraint, binder.names)))}`;
}

function associatedConstraintSemanticKey(
  constraint: RustCompilerAssociatedConstraint,
  boundNames: ReadonlyMap<string, string>,
): string {
  const prefix = `${field(constraint.identity.itemId)}:${list(constraint.genericArguments.map((argument) => rustCompilerGenericArgumentSemanticKey(argument, boundNames)))}`;
  return constraint.kind === "equality"
    ? `equality:${prefix}:${field(typeSemanticKey(constraint.type, boundNames))}`
    : `bounds:${prefix}:${list(constraint.traits.map((trait) => traitSemanticKey(trait, boundNames)))}:${list(constraint.outlives.map((lifetime) => lifetimeSemanticKey(lifetime, boundNames)))}`;
}

export function rustCompilerGenericArgumentSemanticKey(
  argument: RustCompilerGenericArgument,
  boundNames: ReadonlyMap<string, string> = new Map(),
): string {
  switch (argument.kind) {
    case "lifetime": return `lifetime:${field(lifetimeSemanticKey(argument.lifetime, boundNames))}`;
    case "type": return `type:${field(typeSemanticKey(argument.type, boundNames))}`;
    case "const": return `const:${field(constSemanticKey(argument.value))}`;
  }
}

function lifetimeSemanticKey(
  lifetime: RustCompilerLifetime,
  boundNames: ReadonlyMap<string, string>,
): string {
  switch (lifetime.kind) {
    case "static": return "static";
    case "placeholder": return "placeholder";
    case "parameter": return `parameter:${field(lifetime.identity.itemId)}`;
    case "bound": return boundNames.get(lifetime.identity) ?? `bound:${field(lifetime.identity)}`;
    case "elided": return `elided:${field(lifetime.ownerIdentity)}:${field(lifetime.position)}`;
  }
}

function constSemanticKey(value: RustCompilerConstArgument): string {
  switch (value.kind) {
    case "integer": return `integer:${field(value.value)}`;
    case "boolean": return `boolean:${String(value.value)}`;
    case "char": return `char:${field(value.value)}`;
    case "parameter": return `parameter:${field(value.identity.itemId)}`;
    case "infer": return "infer";
  }
}

function binderSemanticContext(
  binder: RustCompilerLifetimeBinder | undefined,
  outerNames: ReadonlyMap<string, string>,
): { readonly key: string; readonly names: ReadonlyMap<string, string> } {
  if (binder === undefined) return Object.freeze({ key: "none", names: outerNames });
  const names = new Map(outerNames);
  for (const [index, parameter] of binder.parameters.entries()) {
    if (parameter.lifetime.kind !== "bound") {
      throw new Error("Rust lifetime binder contains a non-bound lifetime parameter.");
    }
    names.set(parameter.lifetime.identity, `bound:${index}`);
  }
  return Object.freeze({
    key: `binder:${list(binder.parameters.map((parameter) =>
      list(parameter.outlives.map((lifetime) => lifetimeSemanticKey(lifetime, names)))))}`,
    names,
  });
}

function list(values: readonly string[]): string {
  return values.map(field).join(":");
}

function field(value: string): string {
  return `${value.length}:${value}`;
}
