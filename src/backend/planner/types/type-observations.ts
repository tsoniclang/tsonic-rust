import type { RustConstArgument, RustGenericArgument, RustType, RustTypeBound } from "../../target-ast/syntax/nodes.js";

export function collectAliasesFromRustType(
  type: RustType | undefined,
  register: (path: string) => void,
): void {
  if (type === undefined) {
    return;
  }
  switch (type.kind) {
    case "named":
      register(type.path);
      collectAliasesFromRustGenericArguments(type.genericArguments, register);
      return;
    case "qualified":
      collectAliasesFromRustType(type.owner, register);
      collectAliasesFromRustType(type.trait, register);
      collectAliasesFromRustGenericArguments(type.genericArguments, register);
      return;
    case "trait-object":
      collectAliasesFromRustType(type.principal.trait, register);
      for (const trait of type.autoTraits) collectAliasesFromRustType(trait.trait, register);
      return;
    case "impl-trait":
      for (const bound of type.bounds) collectAliasesFromRustTypeBound(bound, register);
      collectAliasesFromRustGenericArguments(type.captures, register);
      return;
    case "reference":
      collectAliasesFromRustType(type.referent, register);
      return;
    case "raw-pointer":
      collectAliasesFromRustType(type.pointee, register);
      return;
    case "function-pointer":
    case "callable-trait":
      for (const parameter of type.parameters) collectAliasesFromRustType(parameter, register);
      collectAliasesFromRustType(type.result, register);
      return;
    case "fixed-array":
      collectAliasesFromRustType(type.element, register);
      collectAliasesFromRustConstArgument(type.length, register);
      return;
    case "slice":
      collectAliasesFromRustType(type.element, register);
      return;
    case "tuple":
      for (const element of type.elements) collectAliasesFromRustType(element, register);
      return;
    case "infer":
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return;
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
      case "const":
        collectAliasesFromRustConstArgument(argument.value, register);
        break;
      case "lifetime":
        break;
    }
  }
}

function collectAliasesFromRustConstArgument(
  argument: RustConstArgument,
  register: (path: string) => void,
): void {
  if (argument.kind === "path") register(argument.path);
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
