import type { RustGenericArgument, RustType, RustTypeBound } from "../../target-ast/nodes.js";

export function rustTypeIsLegalInPosition(
  type: RustType | undefined,
  position: "general" | "parameter" | "return",
): boolean {
  if (type === undefined) return true;
  if (!rustTypeContainsImplTrait(type)) return true;
  if (position === "general") return false;
  switch (type.kind) {
    case "impl-trait":
      return !type.bounds.some(rustTypeBoundContainsImplTrait) &&
        !rustGenericArgumentsContainImplTrait(type.captures);
    case "named":
      return (type.genericArguments ?? []).every(argument => argument.kind === "type"
        ? rustTypeIsLegalInPosition(argument.type, position)
        : !rustGenericArgumentsContainImplTrait([argument]));
    case "reference":
      return rustTypeIsLegalInPosition(type.referent, position);
    case "raw-pointer":
      return rustTypeIsLegalInPosition(type.pointee, position);
    case "fixed-array":
    case "slice":
      return rustTypeIsLegalInPosition(type.element, position);
    case "tuple":
      return type.elements.every(element => rustTypeIsLegalInPosition(element, position));
    default:
      return false;
  }
}

export function rustTypeContainsImplTrait(type: RustType): boolean {
  switch (type.kind) {
    case "impl-trait":
      return true;
    case "named":
      return rustGenericArgumentsContainImplTrait(type.genericArguments);
    case "qualified":
      return rustTypeContainsImplTrait(type.owner) ||
        (type.trait !== undefined && rustTypeContainsImplTrait(type.trait)) ||
        rustGenericArgumentsContainImplTrait(type.genericArguments);
    case "trait-object":
      return rustTypeContainsImplTrait(type.principal.trait) ||
        type.autoTraits.some((trait) => rustTypeContainsImplTrait(trait.trait));
    case "reference":
      return rustTypeContainsImplTrait(type.referent);
    case "raw-pointer":
      return rustTypeContainsImplTrait(type.pointee);
    case "fixed-array":
    case "slice":
      return rustTypeContainsImplTrait(type.element);
    case "function-pointer":
    case "callable-trait":
      return type.parameters.some(rustTypeContainsImplTrait) ||
        rustTypeContainsImplTrait(type.result);
    case "tuple":
      return type.elements.some(rustTypeContainsImplTrait);
    case "infer":
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return false;
  }
}

function rustGenericArgumentsContainImplTrait(
  arguments_: readonly RustGenericArgument[] | undefined,
): boolean {
  return (arguments_ ?? []).some((argument) => {
    switch (argument.kind) {
      case "type":
        return rustTypeContainsImplTrait(argument.type);
      case "associated-equality":
        return rustGenericArgumentsContainImplTrait(argument.genericArguments) ||
          rustTypeContainsImplTrait(argument.type);
      case "associated-bounds":
        return rustGenericArgumentsContainImplTrait(argument.genericArguments) ||
          argument.bounds.some(rustTypeBoundContainsImplTrait);
      case "lifetime":
      case "const":
        return false;
    }
  });
}

function rustTypeBoundContainsImplTrait(bound: RustTypeBound): boolean {
  switch (bound.kind) {
    case "trait-type":
      return rustTypeContainsImplTrait(bound.reference.trait);
    case "callable":
      return bound.parameters.some(rustTypeContainsImplTrait) ||
        rustTypeContainsImplTrait(bound.result);
    case "trait":
    case "lifetime":
    case "maybe-sized":
      return false;
  }
}

export function collectAliasesFromRustType(
  type: RustType | undefined,
  register: (path: string) => void,
): void {
  if (type === undefined) {
    return;
  }
  if (type.kind === "named") {
    register(type.path);
    collectAliasesFromRustGenericArguments(type.genericArguments, register);
    return;
  }
  if (type.kind === "qualified") {
    collectAliasesFromRustType(type.owner, register);
    collectAliasesFromRustType(type.trait, register);
    collectAliasesFromRustGenericArguments(type.genericArguments, register);
    return;
  }
  if (type.kind === "trait-object") {
    collectAliasesFromRustType(type.principal.trait, register);
    for (const trait of type.autoTraits) collectAliasesFromRustType(trait.trait, register);
    return;
  }
  if (type.kind === "impl-trait") {
    for (const bound of type.bounds) collectAliasesFromRustTypeBound(bound, register);
    return;
  }
  if (type.kind === "slice") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "reference") {
    collectAliasesFromRustType(type.referent, register);
    return;
  }
  if (type.kind === "function-pointer" || type.kind === "callable-trait") {
    for (const parameter of type.parameters) {
      collectAliasesFromRustType(parameter, register);
    }
    collectAliasesFromRustType(type.result, register);
    return;
  }
  if (type.kind === "fixed-array") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "tuple") {
    for (const element of type.elements) {
      collectAliasesFromRustType(element, register);
    }
  }
}

function collectAliasesFromRustGenericArguments(
  arguments_: readonly RustGenericArgument[] | undefined,
  register: (path: string) => void,
): void {
  for (const argument of arguments_ ?? []) {
    switch (argument.kind) {
      case "type":
        collectAliasesFromRustType(argument.type, register);
        break;
      case "associated-equality":
        collectAliasesFromRustGenericArguments(argument.genericArguments, register);
        collectAliasesFromRustType(argument.type, register);
        break;
      case "associated-bounds":
        collectAliasesFromRustGenericArguments(argument.genericArguments, register);
        for (const bound of argument.bounds) {
          collectAliasesFromRustTypeBound(bound, register);
        }
        break;
      case "lifetime":
      case "const":
        break;
    }
  }
}

function collectAliasesFromRustTypeBound(
  bound: RustTypeBound,
  register: (path: string) => void,
): void {
  switch (bound.kind) {
    case "trait":
      register(bound.path);
      return;
    case "trait-type":
      collectAliasesFromRustType(bound.reference.trait, register);
      return;
    case "callable":
      for (const parameter of bound.parameters) {
        collectAliasesFromRustType(parameter, register);
      }
      collectAliasesFromRustType(bound.result, register);
      return;
    case "lifetime":
    case "maybe-sized":
      return;
  }
}
