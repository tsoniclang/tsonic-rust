import type { RustType } from "./nodes.js";

export function rustTypeEquals(
  left: RustType | undefined,
  right: RustType | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "infer":
    case "string":
    case "str-ref":
    case "unit":
    case "never":
      return true;
    case "primitive":
      return right.kind === "primitive" && left.name === right.name;
    case "named":
      return right.kind === "named" && namedTypeIdentityEquals(left, right) &&
        sameStrings(left.lifetimeArguments, right.lifetimeArguments) &&
        sameTypes(left.typeArguments, right.typeArguments);
    case "trait-object":
      return right.kind === "trait-object" && rustTypeEquals(left.trait, right.trait);
    case "reference":
      return right.kind === "reference" && left.mutable === right.mutable &&
        rustTypeEquals(left.referent, right.referent);
    case "raw-pointer":
      return right.kind === "raw-pointer" && left.mutable === right.mutable &&
        rustTypeEquals(left.pointee, right.pointee);
    case "fixed-array":
      return right.kind === "fixed-array" && left.length === right.length &&
        rustTypeEquals(left.element, right.element);
    case "slice":
      return right.kind === "slice" && rustTypeEquals(left.element, right.element);
    case "function-pointer":
      return right.kind === "function-pointer" && left.isUnsafe === right.isUnsafe &&
        sameStrings(left.abi, right.abi) &&
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

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return (left ?? []).length === (right ?? []).length &&
    (left ?? []).every((value, index) => value === (right ?? [])[index]);
}

function sameTypes(
  left: readonly RustType[] | undefined,
  right: readonly RustType[] | undefined,
): boolean {
  return (left ?? []).length === (right ?? []).length &&
    (left ?? []).every((value, index) => rustTypeEquals(value, (right ?? [])[index]));
}
