import type {
  RustGenericArgument,
  RustType,
  RustTypeBound,
} from "../../target-ast/nodes.js";

export function collectAliasesFromRustType(
  type: RustType | undefined,
  register: (path: string) => void,
): void {
  if (type === undefined) return;
  if (type.kind === "named") {
    register(type.path);
    for (const argument of type.genericArguments ?? []) {
      collectAliasesFromRustGenericArgument(argument, register);
    }
    return;
  }
  if (type.kind === "qualified") {
    collectAliasesFromRustType(type.owner, register);
    collectAliasesFromRustType(type.trait, register);
    for (const argument of type.genericArguments ?? []) {
      collectAliasesFromRustGenericArgument(argument, register);
    }
    return;
  }
  if (type.kind === "trait-object" || type.kind === "opaque") {
    for (const bound of type.bounds) collectAliasesFromRustTypeBound(bound, register);
    return;
  }
  if (type.kind === "slice" || type.kind === "fixed-array") {
    collectAliasesFromRustType(type.element, register);
    return;
  }
  if (type.kind === "reference") {
    collectAliasesFromRustType(type.referent, register);
    return;
  }
  if (type.kind === "raw-pointer") {
    collectAliasesFromRustType(type.pointee, register);
    return;
  }
  if (type.kind === "function-pointer") {
    for (const parameter of type.parameters) {
      collectAliasesFromRustType(parameter, register);
    }
    collectAliasesFromRustType(type.result, register);
    return;
  }
  if (type.kind === "tuple") {
    for (const element of type.elements) {
      collectAliasesFromRustType(element, register);
    }
  }
}

function collectAliasesFromRustGenericArgument(
  argument: RustGenericArgument,
  register: (path: string) => void,
): void {
  if (argument.kind === "type") {
    collectAliasesFromRustType(argument.type, register);
    return;
  }
  if (argument.kind === "associated-equality") {
    collectAliasesFromRustType(argument.type, register);
  } else if (argument.kind === "associated-bounds") {
    for (const bound of argument.bounds) collectAliasesFromRustTypeBound(bound, register);
  } else {
    return;
  }
  for (const nested of argument.genericArguments ?? []) {
    collectAliasesFromRustGenericArgument(nested, register);
  }
}

function collectAliasesFromRustTypeBound(
  bound: RustTypeBound,
  register: (path: string) => void,
): void {
  if (bound.kind === "trait") {
    collectAliasesFromRustType(bound.trait, register);
  } else if (bound.kind === "callable-trait") {
    bound.parameters.forEach((parameter) => collectAliasesFromRustType(parameter, register));
    collectAliasesFromRustType(bound.result, register);
  } else if (bound.kind === "precise-capture") {
    bound.captures.forEach((capture) =>
      collectAliasesFromRustGenericArgument(capture, register));
  }
}
