import type { RustGenericArgument, RustType, RustTypeBound } from "../../target-ast/syntax/nodes.js";

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
