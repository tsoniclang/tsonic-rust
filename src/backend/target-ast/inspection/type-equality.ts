import type {
  RustGenericArgument,
  RustLifetime,
  RustLifetimeParameter,
  RustTraitReference,
  RustType,
  RustTypeBound,
} from "../nodes.js";

export function rustTypeEquals(
  left: RustType | undefined,
  right: RustType | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "infer":
    case "string":
    case "str":
    case "unit":
    case "never":
      return true;
    case "primitive":
      return right.kind === "primitive" && left.name === right.name;
    case "named":
      return right.kind === "named" && namedTypeIdentityEquals(left, right) &&
        genericArgumentsEqual(left.genericArguments, right.genericArguments);
    case "qualified":
      return right.kind === "qualified" && left.member === right.member &&
        rustTypeEquals(left.owner, right.owner) && rustTypeEquals(left.trait, right.trait) &&
        genericArgumentsEqual(left.genericArguments, right.genericArguments);
    case "trait-object":
      return right.kind === "trait-object" &&
        traitReferencesEqual(left.principal, right.principal) &&
        sameTraitReferences(left.autoTraits, right.autoTraits) &&
        lifetimeEqual(left.lifetime, right.lifetime);
    case "impl-trait":
      return right.kind === "impl-trait" &&
        boundsEqual(left.bounds, right.bounds) &&
        lifetimeListsEqual(left.outlives, right.outlives) &&
        lifetimeListsEqual(left.captures, right.captures);
    case "reference":
      return right.kind === "reference" && left.mutable === right.mutable &&
        lifetimeEqual(left.lifetime, right.lifetime) &&
        rustTypeEquals(left.referent, right.referent);
    case "raw-pointer":
      return right.kind === "raw-pointer" && left.mutable === right.mutable &&
        rustTypeEquals(left.pointee, right.pointee);
    case "fixed-array":
      return right.kind === "fixed-array" &&
        constArgumentsEqual(left.length, right.length) &&
        rustTypeEquals(left.element, right.element);
    case "slice":
      return right.kind === "slice" && rustTypeEquals(left.element, right.element);
    case "function-pointer":
      return right.kind === "function-pointer" && left.isUnsafe === right.isUnsafe &&
        sameStrings(left.abi, right.abi) && bindersEqual(left.binder, right.binder) &&
        sameTypes(left.parameters, right.parameters) &&
        rustTypeEquals(left.result, right.result);
    case "tuple":
      return right.kind === "tuple" && sameTypes(left.elements, right.elements);
  }
}

function namedTypeIdentityEquals(
  left: Extract<RustType, { readonly kind: "named" }>,
  right: Extract<RustType, { readonly kind: "named" }>,
): boolean {
  return left.identity === undefined && right.identity === undefined
    ? left.path === right.path
    : left.identity !== undefined && left.identity === right.identity;
}

function genericArgumentsEqual(
  left: readonly RustGenericArgument[] | undefined,
  right: readonly RustGenericArgument[] | undefined,
): boolean {
  const leftArguments = left ?? [];
  const rightArguments = right ?? [];
  return leftArguments.length === rightArguments.length &&
    leftArguments.every((argument, index) => {
      const other = rightArguments[index];
      if (other === undefined || argument.kind !== other.kind) return false;
      switch (argument.kind) {
        case "lifetime":
          return other.kind === "lifetime" && lifetimeEqual(argument.lifetime, other.lifetime);
        case "type":
          return other.kind === "type" && rustTypeEquals(argument.type, other.type);
        case "const":
          return other.kind === "const" && constArgumentsEqual(argument.value, other.value);
        case "associated-equality":
          return other.kind === "associated-equality" && argument.name === other.name &&
            genericArgumentsEqual(argument.genericArguments, other.genericArguments) &&
            rustTypeEquals(argument.type, other.type);
        case "associated-bounds":
          return other.kind === "associated-bounds" && argument.name === other.name &&
            genericArgumentsEqual(argument.genericArguments, other.genericArguments) &&
            boundsEqual(argument.bounds, other.bounds);
      }
    });
}

function constArgumentsEqual(
  left: import("../nodes.js").RustConstArgument,
  right: import("../nodes.js").RustConstArgument,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "integer":
    case "boolean":
    case "char":
      return right.kind === left.kind && left.value === right.value;
    case "path":
      return right.kind === "path" && left.path === right.path;
    case "infer":
      return true;
  }
}

function lifetimeEqual(
  left: RustLifetime | undefined,
  right: RustLifetime | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.kind === right.kind &&
      (left.kind !== "named" || right.kind === "named" && left.name === right.name);
}

function lifetimeListsEqual(
  left: readonly RustLifetime[],
  right: readonly RustLifetime[],
): boolean {
  return left.length === right.length && left.every((value, index) =>
    lifetimeEqual(value, right[index]));
}

function bindersEqual(
  left: readonly RustLifetimeParameter[] | undefined,
  right: readonly RustLifetimeParameter[] | undefined,
): boolean {
  const leftParameters = left ?? [];
  const rightParameters = right ?? [];
  return leftParameters.length === rightParameters.length &&
    leftParameters.every((parameter, index) => {
      const other = rightParameters[index];
      return other !== undefined && parameter.name === other.name &&
        lifetimeListsEqual(parameter.outlives, other.outlives);
    });
}

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return (left ?? []).length === (right ?? []).length &&
    (left ?? []).every((value, index) => value === (right ?? [])[index]);
}

function boundsEqual(
  left: readonly RustTypeBound[],
  right: readonly RustTypeBound[],
): boolean {
  return left.length === right.length && left.every((bound, index) => {
    const other = right[index];
    if (other === undefined || bound.kind !== other.kind) return false;
    switch (bound.kind) {
      case "trait":
        return other.kind === "trait" && bound.path === other.path;
      case "trait-type":
        return other.kind === "trait-type" &&
          traitReferencesEqual(bound.reference, other.reference);
      case "lifetime":
        return other.kind === "lifetime" && lifetimeEqual(bound.lifetime, other.lifetime);
      case "callable":
        return other.kind === "callable" && bound.trait === other.trait &&
          bindersEqual(bound.binder, other.binder) &&
          sameTypes(bound.parameters, other.parameters) &&
          rustTypeEquals(bound.result, other.result);
      case "maybe-sized":
        return true;
    }
  });
}

function traitReferencesEqual(
  left: RustTraitReference,
  right: RustTraitReference,
): boolean {
  return bindersEqual(left.binder, right.binder) &&
    rustTypeEquals(left.trait, right.trait);
}

function sameTraitReferences(
  left: readonly RustTraitReference[],
  right: readonly RustTraitReference[],
): boolean {
  return left.length === right.length && left.every((value, index) =>
    traitReferencesEqual(value, right[index]!));
}

function sameTypes(
  left: readonly RustType[] | undefined,
  right: readonly RustType[] | undefined,
): boolean {
  return (left ?? []).length === (right ?? []).length &&
    (left ?? []).every((value, index) => rustTypeEquals(value, (right ?? [])[index]));
}
