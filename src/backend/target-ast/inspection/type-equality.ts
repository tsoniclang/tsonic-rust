import type {
  RustConstExpression,
  RustGenericArgument,
  RustGenericParameter,
  RustLifetime,
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
        sameGenericArguments(left.genericArguments, right.genericArguments);
    case "qualified":
      return right.kind === "qualified" &&
        rustTypeEquals(left.owner, right.owner) &&
        rustTypeEquals(left.trait, right.trait) &&
        left.member === right.member &&
        sameGenericArguments(left.genericArguments, right.genericArguments);
    case "trait-object":
      return right.kind === "trait-object" &&
        sameBounds(left.bounds, right.bounds) &&
        lifetimeEquals(left.lifetime, right.lifetime);
    case "opaque":
      return right.kind === "opaque" && sameBounds(left.bounds, right.bounds);
    case "reference":
      return right.kind === "reference" && left.mutable === right.mutable &&
        lifetimeEquals(left.lifetime, right.lifetime) &&
        rustTypeEquals(left.referent, right.referent);
    case "raw-pointer":
      return right.kind === "raw-pointer" && left.mutable === right.mutable &&
        rustTypeEquals(left.pointee, right.pointee);
    case "fixed-array":
      return right.kind === "fixed-array" &&
        constExpressionEquals(left.length, right.length) &&
        rustTypeEquals(left.element, right.element);
    case "slice":
      return right.kind === "slice" && rustTypeEquals(left.element, right.element);
    case "function-pointer":
      return right.kind === "function-pointer" &&
        left.isUnsafe === right.isUnsafe && left.abi === right.abi &&
        left.variadic === right.variadic &&
        sameLifetimeParameters(left.binder, right.binder) &&
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

function lifetimeEquals(
  left: RustLifetime | undefined,
  right: RustLifetime | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.kind === right.kind &&
    (left.kind !== "named" || right.kind === "named" && left.name === right.name);
}

function constExpressionEquals(
  left: RustConstExpression,
  right: RustConstExpression,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "integer": return right.kind === "integer" && left.value === right.value;
    case "boolean": return right.kind === "boolean" && left.value === right.value;
    case "character": return right.kind === "character" && left.value === right.value;
    case "inferred": return true;
    case "path":
      return right.kind === "path" && left.path === right.path &&
        sameGenericArguments(left.genericArguments, right.genericArguments);
    case "unary":
      return right.kind === "unary" && left.operator === right.operator &&
        constExpressionEquals(left.operand, right.operand);
    case "binary":
      return right.kind === "binary" && left.operator === right.operator &&
        constExpressionEquals(left.left, right.left) &&
        constExpressionEquals(left.right, right.right);
  }
}

function genericArgumentEquals(left: RustGenericArgument, right: RustGenericArgument): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "lifetime":
      return right.kind === "lifetime" && lifetimeEquals(left.lifetime, right.lifetime);
    case "type":
      return right.kind === "type" && rustTypeEquals(left.type, right.type);
    case "const":
      return right.kind === "const" && constExpressionEquals(left.expression, right.expression);
    case "associated-equality":
      return right.kind === "associated-equality" && left.name === right.name &&
        sameGenericArguments(left.genericArguments, right.genericArguments) &&
        rustTypeEquals(left.type, right.type);
    case "associated-bounds":
      return right.kind === "associated-bounds" && left.name === right.name &&
        sameGenericArguments(left.genericArguments, right.genericArguments) &&
        sameBounds(left.bounds, right.bounds);
  }
}

function boundEquals(left: RustTypeBound, right: RustTypeBound): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "lifetime":
      return right.kind === "lifetime" && lifetimeEquals(left.lifetime, right.lifetime);
    case "trait":
      return right.kind === "trait" && left.polarity === right.polarity &&
        sameLifetimeParameters(left.binder, right.binder) &&
        rustTypeEquals(left.trait, right.trait);
    case "callable-trait":
      return right.kind === "callable-trait" && left.trait === right.trait &&
        sameLifetimeParameters(left.binder, right.binder) &&
        sameTypes(left.parameters, right.parameters) &&
        rustTypeEquals(left.result, right.result);
    case "precise-capture":
      return right.kind === "precise-capture" &&
        sameGenericArguments(left.captures, right.captures);
  }
}

function sameLifetimeParameters(
  left: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[] | undefined,
  right: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[] | undefined,
): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => {
      const other = rightValues[index]!;
      return value.name === other.name &&
        value.bounds.length === other.bounds.length &&
        value.bounds.every((bound, boundIndex) =>
          lifetimeEquals(bound, other.bounds[boundIndex]));
    });
}

function sameGenericArguments(
  left: readonly RustGenericArgument[] | undefined,
  right: readonly RustGenericArgument[] | undefined,
): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => genericArgumentEquals(value, rightValues[index]!));
}

function sameBounds(
  left: readonly RustTypeBound[],
  right: readonly RustTypeBound[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => boundEquals(value, right[index]!));
}

function sameTypes(
  left: readonly RustType[],
  right: readonly RustType[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => rustTypeEquals(value, right[index]));
}
