import type {
  RustCompilerAssociatedConstant,
  RustCompilerAssociatedType,
  RustCompilerBound,
  RustCompilerConstExpression,
  RustCompilerExport,
  RustCompilerFunction,
  RustCompilerGenericArgument,
  RustCompilerGenerics,
  RustCompilerImplementation,
  RustCompilerItemIdentity,
  RustCompilerGenericParameter,
  RustCompilerModuleModel,
  RustCompilerTraitReference,
  RustCompilerType,
  RustCompilerTypeTraits,
} from "./model.js";

export interface RustCompilerReferenceVisitor {
  readonly type: (identity: RustCompilerItemIdentity) => void;
  readonly trait: (identity: RustCompilerItemIdentity) => void;
  readonly genericParameter?: (identity: string) => void;
}

export function rustCompilerGenericParameterDependencies(
  parameter: RustCompilerGenericParameter,
): ReadonlySet<string> {
  const dependencies = new Set<string>();
  const visitor: RustCompilerReferenceVisitor = {
    type: () => {},
    trait: () => {},
    genericParameter: (identity) => dependencies.add(identity),
  };
  visitGenericParameter(parameter, visitor);
  return dependencies;
}

export function visitRustCompilerModuleReferences(
  module: Pick<RustCompilerModuleModel, "exports" | "implementations">,
  visitor: RustCompilerReferenceVisitor,
): void {
  for (const exported of module.exports) {
    visitRustCompilerExportReferences(exported, visitor, { includeTargetTraitMetadata: true });
  }
  for (const implementation of module.implementations) {
    visitRustCompilerImplementationReferences(implementation, visitor);
  }
}

export function visitRustCompilerExportReferences(
  exported: RustCompilerExport,
  visitor: RustCompilerReferenceVisitor,
  options: { readonly includeTargetTraitMetadata: boolean } = { includeTargetTraitMetadata: false },
): void {
  if (exported.kind === "constant" || exported.kind === "static") {
    visitRustCompilerTypeReferences(exported.type, visitor);
    return;
  }
  if (exported.kind === "function") {
    visitRustCompilerFunctionReferences(exported.function, visitor);
    return;
  }
  if (exported.kind === "type-alias") {
    visitRustCompilerGenericsReferences(exported.generics, visitor);
    visitRustCompilerTypeReferences(exported.type, visitor);
    return;
  }
  (exported.kind === "trait" ? visitor.trait : visitor.type)(exported.identity);
  visitRustCompilerGenericsReferences(exported.generics, visitor);
  exported.methods.forEach((fn) => visitRustCompilerFunctionReferences(fn, visitor));
  exported.associatedConstants.forEach((constant) => visitAssociatedConstant(constant, visitor));
  exported.associatedTypes.forEach((associated) => visitAssociatedType(associated, visitor));
  if (options.includeTargetTraitMetadata) visitTypeTraits(exported.traits, visitor);
  if (exported.kind === "struct" || exported.kind === "union") {
    exported.fields.forEach((field) => visitRustCompilerTypeReferences(field.type, visitor));
  } else if (exported.kind === "enum") {
    exported.variants.forEach((variant) => {
      if (variant.discriminant !== undefined) visitConst(variant.discriminant, visitor);
      if (variant.fields.kind !== "unit") {
        variant.fields.fields.forEach((field) => visitRustCompilerTypeReferences(field.type, visitor));
      }
    });
  } else {
    exported.superTraits.forEach((bound) => visitBound(bound, visitor));
  }
}

export function visitRustCompilerImplementationReferences(
  implementation: RustCompilerImplementation,
  visitor: RustCompilerReferenceVisitor,
): void {
  visitRustCompilerGenericsReferences(implementation.generics, visitor);
  visitRustCompilerTypeReferences(implementation.target, visitor);
  if (implementation.trait !== undefined) visitRustCompilerTraitReferences(implementation.trait, visitor);
  implementation.methods.forEach((fn) => visitRustCompilerFunctionReferences(fn, visitor));
  implementation.associatedConstants.forEach((constant) => visitAssociatedConstant(constant, visitor));
  implementation.associatedTypes.forEach((associated) => visitAssociatedType(associated, visitor));
}

function visitAssociatedConstant(
  constant: RustCompilerAssociatedConstant,
  visitor: RustCompilerReferenceVisitor,
): void {
  visitRustCompilerGenericsReferences(constant.generics, visitor);
  visitRustCompilerTypeReferences(constant.type, visitor);
  if (constant.traitDispatch !== undefined) visitRustCompilerTraitReferences(constant.traitDispatch, visitor);
}

function visitAssociatedType(
  associated: RustCompilerAssociatedType,
  visitor: RustCompilerReferenceVisitor,
): void {
  visitRustCompilerGenericsReferences(associated.generics, visitor);
  associated.bounds.forEach((bound) => visitBound(bound, visitor));
  if (associated.defaultType !== undefined) visitRustCompilerTypeReferences(associated.defaultType, visitor);
}

function visitTypeTraits(
  traits: RustCompilerTypeTraits,
  visitor: RustCompilerReferenceVisitor,
): void {
  for (const implementation of traits.implementations) {
    visitRustCompilerTraitReferences(implementation.trait, visitor);
    implementation.requirements.forEach((requirement) => visitRustCompilerTraitReferences(requirement.trait, visitor));
  }
}

export function visitRustCompilerFunctionReferences(
  fn: RustCompilerFunction,
  visitor: RustCompilerReferenceVisitor,
): void {
  visitRustCompilerGenericsReferences(fn.enclosingGenerics, visitor);
  visitRustCompilerGenericsReferences(fn.generics, visitor);
  if (fn.receiver !== undefined) visitRustCompilerTypeReferences(fn.receiver.type, visitor);
  fn.parameters.forEach((parameter) => visitRustCompilerTypeReferences(parameter.type, visitor));
  visitRustCompilerTypeReferences(fn.result, visitor);
  if (fn.traitDispatch !== undefined) visitRustCompilerTraitReferences(fn.traitDispatch, visitor);
}

export function visitRustCompilerGenericsReferences(
  generics: RustCompilerGenerics,
  visitor: RustCompilerReferenceVisitor,
): void {
  for (const parameter of generics.parameters) {
    visitGenericParameter(parameter, visitor);
  }
  for (const predicate of generics.wherePredicates) {
    if (predicate.kind === "type") {
      visitRustCompilerTypeReferences(predicate.type, visitor);
      predicate.bounds.forEach((bound) => visitBound(bound, visitor));
    } else if (predicate.kind === "equality") {
      visitRustCompilerTypeReferences(predicate.projection, visitor);
      visitRustCompilerTypeReferences(predicate.value, visitor);
    }
  }
}

function visitGenericParameter(
  parameter: RustCompilerGenericParameter,
  visitor: RustCompilerReferenceVisitor,
): void {
  if (parameter.kind === "lifetime") {
    parameter.bounds.forEach((lifetime) => visitLifetime(lifetime, visitor));
  } else if (parameter.kind === "type") {
    parameter.bounds.forEach((bound) => visitBound(bound, visitor));
    if (parameter.defaultType !== undefined) visitRustCompilerTypeReferences(parameter.defaultType, visitor);
  } else {
    visitRustCompilerTypeReferences(parameter.type, visitor);
    if (parameter.defaultValue !== undefined) visitConst(parameter.defaultValue, visitor);
  }
}

function visitArgument(
  argument: RustCompilerGenericArgument,
  visitor: RustCompilerReferenceVisitor,
): void {
  if (argument.kind === "type") visitRustCompilerTypeReferences(argument.value, visitor);
  else if (argument.kind === "lifetime") visitLifetime(argument.value, visitor);
  else visitConst(argument.value, visitor);
}

function visitLifetime(
  lifetime: import("./model.js").RustCompilerLifetime,
  visitor: RustCompilerReferenceVisitor,
): void {
  if (lifetime.kind === "parameter") visitor.genericParameter?.(lifetime.identity.itemId);
  else if (lifetime.kind === "bound") visitor.genericParameter?.(lifetime.parameterId);
}

function visitConst(
  expression: RustCompilerConstExpression,
  visitor: RustCompilerReferenceVisitor,
): void {
  switch (expression.kind) {
    case "literal":
    case "item":
    case "inferred": return;
    case "parameter": visitor.genericParameter?.(expression.identity.itemId); return;
    case "unary": visitConst(expression.operand, visitor); return;
    case "binary":
      visitConst(expression.left, visitor);
      visitConst(expression.right, visitor);
      return;
  }
}

export function visitRustCompilerTraitReferences(
  trait: RustCompilerTraitReference,
  visitor: RustCompilerReferenceVisitor,
): void {
  visitor.trait(trait.identity);
  trait.arguments.forEach((argument) => visitArgument(argument, visitor));
  trait.associatedConstraints.forEach((constraint) => {
    constraint.arguments.forEach((argument) => visitArgument(argument, visitor));
    if (constraint.kind === "equality") visitRustCompilerTypeReferences(constraint.type, visitor);
    else constraint.bounds.forEach((bound) => visitBound(bound, visitor));
  });
}

function visitBound(
  bound: RustCompilerBound,
  visitor: RustCompilerReferenceVisitor,
): void {
  switch (bound.kind) {
    case "trait": visitRustCompilerTraitReferences(bound.trait, visitor); return;
    case "lifetime-outlives":
      visitLifetime(bound.longer, visitor);
      visitLifetime(bound.shorter, visitor);
      return;
    case "type-outlives":
      visitRustCompilerTypeReferences(bound.type, visitor);
      visitLifetime(bound.lifetime, visitor);
      return;
    case "associated-equality":
      visitRustCompilerTypeReferences(bound.projection, visitor);
      visitRustCompilerTypeReferences(bound.value, visitor);
      return;
    case "precise-capture":
      bound.captures.forEach((argument) => visitArgument(argument, visitor));
      return;
  }
}

export function visitRustCompilerTypeReferences(
  type: RustCompilerType,
  visitor: RustCompilerReferenceVisitor,
): void {
  switch (type.kind) {
    case "unit":
    case "never":
    case "primitive":
    case "self":
      return;
    case "type-parameter": visitor.genericParameter?.(type.identity.itemId); return;
    case "tuple": type.elements.forEach((element) => visitRustCompilerTypeReferences(element, visitor)); return;
    case "array":
      visitRustCompilerTypeReferences(type.element, visitor);
      visitConst(type.length, visitor);
      return;
    case "slice": visitRustCompilerTypeReferences(type.element, visitor); return;
    case "reference":
      visitRustCompilerTypeReferences(type.target, visitor);
      visitLifetime(type.lifetime, visitor);
      return;
    case "raw-pointer": visitRustCompilerTypeReferences(type.target, visitor); return;
    case "function-pointer":
      type.parameters.forEach((parameter) => visitRustCompilerTypeReferences(parameter, visitor));
      visitRustCompilerTypeReferences(type.result, visitor);
      return;
    case "trait-object":
      visitRustCompilerTraitReferences(type.principal, visitor);
      type.autoTraits.forEach((trait) => visitRustCompilerTraitReferences(trait, visitor));
      return;
    case "opaque":
      type.bounds.forEach((bound) => visitBound(bound, visitor));
      type.captures.forEach((argument) => visitArgument(argument, visitor));
      return;
    case "associated-type":
      visitRustCompilerTypeReferences(type.owner, visitor);
      visitRustCompilerTraitReferences(type.trait, visitor);
      type.arguments.forEach((argument) => visitArgument(argument, visitor));
      return;
    case "path":
      visitor.type(type.identity);
      type.arguments.forEach((argument) => visitArgument(argument, visitor));
      return;
  }
}
