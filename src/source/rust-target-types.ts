import type { SourcePrimitiveKind, TargetTypeRef } from "@tsonic/tsts";
import type { RustPrimitiveTypeName } from "../common/rust-syntax.js";
import { closedMetadataEquals, isClosedMetadata, isDenseDataArray } from "../common/closed-metadata.js";

export type { RustPrimitiveTypeName } from "../common/rust-syntax.js";

// Rust carrier identities. Carriers are TargetTypeRefs selected by facts; the
// backend renders them to Rust type text only at the printer boundary.

export const rustStringTargetId = "rust.std.String";
export const rustOptionTargetId = "rust.std.Option";
export const rustJsValueTargetId = "rust.js.JsValue";
export const rustJsArrayTargetId = "rust.js.JsArray";
export const rustJsMapTargetId = "rust.js.JsMap";
export const rustJsSetTargetId = "rust.js.JsSet";
export const rustJsDateTargetId = "rust.js.JsDate";
export const rustUsizeTargetId = "rust.core.usize";
export const rustIsizeTargetId = "rust.core.isize";
export const rustNamedTypeCarrierName = "named-type";

export function rustSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return { kind: "source-primitive", name: kind };
}

export function rustStringTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustStringTargetId };
}

export function rustUsizeTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustUsizeTargetId };
}

export function rustIsizeTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustIsizeTargetId };
}

export function rustUnitTargetType(): TargetTypeRef {
  return { kind: "tuple", elements: [] };
}

export function rustVecTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "array", element };
}

export function rustTupleTargetType(elements: readonly TargetTypeRef[]): TargetTypeRef {
  const [first] = elements;
  if (elements.length >= 2 && first?.kind === "source-primitive" && elements.every((element) =>
    element.kind === "source-primitive" && element.name === first.name)) {
    return rustFixedArrayTargetType(first, elements.length);
  }
  return { kind: "tuple", elements };
}

export interface RustFixedArrayCarrierValue {
  readonly element: TargetTypeRef;
  readonly length: number;
}

export interface RustNamedTypeCarrierValue {
  readonly id: string;
  readonly path: string;
  readonly typeArguments: readonly TargetTypeRef[];
}

export function rustNamedTargetType(
  id: string,
  path: string,
  typeArguments: readonly TargetTypeRef[] = [],
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: rustNamedTypeCarrierName,
    value: { id, path, typeArguments },
  };
}

export function rustNamedTypeCarrierValue(carrier: TargetTypeRef | undefined): RustNamedTypeCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== rustNamedTypeCarrierName) {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== "id" || keys[1] !== "path" || keys[2] !== "typeArguments") {
    return undefined;
  }
  const candidate = value as {
    readonly id?: unknown;
    readonly path?: unknown;
    readonly typeArguments?: unknown;
  };
  if (typeof candidate.id !== "string" || candidate.id.length === 0 ||
    typeof candidate.path !== "string" || candidate.path.length === 0 ||
    !isDenseDataArray(candidate.typeArguments) ||
    candidate.typeArguments.some((argument) => !isRustTargetTypeRef(argument))) {
    return undefined;
  }
  return {
    id: candidate.id,
    path: candidate.path,
    typeArguments: candidate.typeArguments as readonly TargetTypeRef[],
  };
}

export function rustFixedArrayTargetType(element: TargetTypeRef, length: number): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: "fixed-array",
    value: { element, length },
  };
}

export function rustFixedArrayCarrierValue(carrier: TargetTypeRef | undefined): RustFixedArrayCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "fixed-array") {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "element" || keys[1] !== "length") {
    return undefined;
  }
  const length = (value as { readonly length?: unknown }).length;
  const element = (value as { readonly element?: unknown }).element;
  return Number.isSafeInteger(length) && (length as number) >= 0 && isRustTargetTypeRef(element)
    ? { element: element as TargetTypeRef, length: length as number }
    : undefined;
}

export function rustTargetTypeRefEquals(left: TargetTypeRef | undefined, right: TargetTypeRef | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (!isRustTargetTypeRef(left) || !isRustTargetTypeRef(right)) {
    return false;
  }
  return rustTargetTypeRefEqualsValidated(left, right);
}

export function substituteRustTargetTypeParameters(
  type: TargetTypeRef,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): TargetTypeRef {
  switch (type.kind) {
    case "type-parameter":
      return substitutions.get(type.name) ?? type;
    case "target-named":
      return type.typeArguments === undefined
        ? type
        : { ...type, typeArguments: type.typeArguments.map((argument) => substituteRustTargetTypeParameters(argument, substitutions)) };
    case "array":
      return { ...type, element: substituteRustTargetTypeParameters(type.element, substitutions) };
    case "tuple":
      return { ...type, elements: type.elements.map((element) => substituteRustTargetTypeParameters(element, substitutions)) };
    case "pointer":
      return { ...type, pointee: substituteRustTargetTypeParameters(type.pointee, substitutions) };
    case "function-pointer":
      return {
        ...type,
        args: type.args.map((argument) => substituteRustTargetTypeParameters(argument, substitutions)),
        result: substituteRustTargetTypeParameters(type.result, substitutions),
      };
    case "associated-type":
      return { ...type, owner: substituteRustTargetTypeParameters(type.owner, substitutions) };
    default:
      return type;
  }
}

export function inferRustTargetTypeParameterBindings(
  pattern: TargetTypeRef,
  actual: TargetTypeRef,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const bindings = new Map<string, TargetTypeRef>();
  return match(pattern, actual) ? bindings : undefined;

  function match(left: TargetTypeRef, right: TargetTypeRef): boolean {
    if (left.kind === "type-parameter" && parameterNames.has(left.name)) {
      const existing = bindings.get(left.name);
      if (existing === undefined) {
        bindings.set(left.name, right);
        return true;
      }
      return rustTargetTypeRefEquals(existing, right);
    }
    if (left.kind !== right.kind) {
      return false;
    }
    switch (left.kind) {
      case "target-named": {
        if (right.kind !== "target-named" || left.id !== right.id) {
          return false;
        }
        const leftArguments = left.typeArguments ?? [];
        const rightArguments = right.typeArguments ?? [];
        return leftArguments.length === rightArguments.length &&
          leftArguments.every((argument, index) => match(argument, rightArguments[index]!));
      }
      case "array":
        return right.kind === "array" && left.rank === right.rank && match(left.element, right.element);
      case "tuple":
        return right.kind === "tuple" && left.elements.length === right.elements.length &&
          left.elements.every((element, index) => match(element, right.elements[index]!));
      case "pointer":
        return right.kind === "pointer" && left.mutability === right.mutability && match(left.pointee, right.pointee);
      case "function-pointer":
        return right.kind === "function-pointer" && stringListsEqual(left.abi, right.abi) &&
          left.args.length === right.args.length && left.args.every((argument, index) => match(argument, right.args[index]!)) &&
          match(left.result, right.result);
      case "associated-type":
        return right.kind === "associated-type" && left.name === right.name && match(left.owner, right.owner);
      default:
        return rustTargetTypeRefEquals(left, right);
    }
  }
}

function rustTargetTypeRefEqualsValidated(left: TargetTypeRef, right: TargetTypeRef): boolean {
  if (left === right) {
    return true;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "source-primitive":
      return right.kind === left.kind && left.name === right.name;
    case "target-named":
      return right.kind === left.kind && left.id === right.id && targetTypeRefListsEqual(left.typeArguments, right.typeArguments);
    case "type-parameter":
    case "lifetime":
      return right.kind === left.kind && left.name === right.name;
    case "opaque":
      return right.kind === left.kind && left.id === right.id;
    case "array":
      return right.kind === left.kind && left.rank === right.rank && rustTargetTypeRefEqualsValidated(left.element, right.element);
    case "tuple":
      return right.kind === left.kind && targetTypeRefListsEqual(left.elements, right.elements);
    case "pointer":
      return right.kind === left.kind && left.mutability === right.mutability && rustTargetTypeRefEqualsValidated(left.pointee, right.pointee);
    case "function-pointer":
      return right.kind === left.kind &&
        stringListsEqual(left.abi, right.abi) &&
        targetTypeRefListsEqual(left.args, right.args) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result);
    case "associated-type":
      return right.kind === left.kind && left.name === right.name && rustTargetTypeRefEqualsValidated(left.owner, right.owner);
    case "target-specific":
      return right.kind === left.kind && left.target === right.target && left.name === right.name && closedMetadataEquals(left.value, right.value);
  }
}

export function isRustTargetTypeRef(value: unknown): value is TargetTypeRef {
  try {
    return validateRustTargetTypeRef(value, new WeakSet<object>(), 0);
  } catch {
    return false;
  }
}

function validateRustTargetTypeRef(value: unknown, active: WeakSet<object>, depth: number): value is TargetTypeRef {
  if (!isPlainRecord(value) || depth > 128 || active.has(value)) {
    return false;
  }
  active.add(value);
  try {
    const validateChild = (child: unknown): child is TargetTypeRef =>
      validateRustTargetTypeRef(child, active, depth + 1);
    const validateChildren = (children: unknown): children is readonly TargetTypeRef[] =>
      isDenseDataArray(children) && children.every(validateChild);
    switch (value.kind) {
      case "source-primitive":
        return hasExactKeys(value, ["kind", "name"], ["kind", "name"]) && sourcePrimitiveNames.has(value.name);
      case "target-named":
        return hasExactKeys(value, ["kind", "id", "typeArguments"], ["kind", "id"]) &&
          typeof value.id === "string" && value.id.length > 0 &&
          (value.typeArguments === undefined || validateChildren(value.typeArguments));
      case "type-parameter":
      case "lifetime":
        return hasExactKeys(value, ["kind", "name"], ["kind", "name"]) && typeof value.name === "string" && value.name.length > 0;
      case "array":
        return hasExactKeys(value, ["kind", "element", "rank"], ["kind", "element"]) && validateChild(value.element) &&
          (value.rank === undefined || (Number.isSafeInteger(value.rank) && (value.rank as number) > 0));
      case "tuple":
        return hasExactKeys(value, ["kind", "elements"], ["kind", "elements"]) && validateChildren(value.elements);
      case "pointer":
        return hasExactKeys(value, ["kind", "pointee", "mutability"], ["kind", "pointee"]) && validateChild(value.pointee) &&
          (value.mutability === undefined || value.mutability === "const" || value.mutability === "mut" ||
            value.mutability === "target-defined");
      case "function-pointer":
        return hasExactKeys(value, ["kind", "args", "result", "abi"], ["kind", "args", "result"]) && validateChildren(value.args) &&
          validateChild(value.result) &&
          (value.abi === undefined || (isDenseDataArray(value.abi) && value.abi.every((part) => typeof part === "string")));
      case "opaque":
        return hasExactKeys(value, ["kind", "id"], ["kind", "id"]) && typeof value.id === "string" && value.id.length > 0;
      case "associated-type":
        return hasExactKeys(value, ["kind", "owner", "name"], ["kind", "owner", "name"]) && validateChild(value.owner) &&
          typeof value.name === "string" && value.name.length > 0;
      case "target-specific":
        return hasExactKeys(value, ["kind", "target", "name", "value"], ["kind", "target", "name"]) &&
          typeof value.target === "string" && value.target.length > 0 &&
          typeof value.name === "string" && value.name.length > 0 &&
          (!Object.prototype.hasOwnProperty.call(value, "value") || isClosedMetadata(value.value));
      default:
        return false;
    }
  } finally {
    active.delete(value);
  }
}

const sourcePrimitiveNames = new Set<unknown>([
  "bool", "char", "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
  "native-int", "native-uint", "float16", "float32", "float64", "decimal", "int128", "uint128",
]);

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function targetTypeRefListsEqual(
  left: readonly TargetTypeRef[] | undefined,
  right: readonly TargetTypeRef[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined || left.length !== right.length) {
    return false;
  }
  if (!isDenseDataArray(left) || !isDenseDataArray(right)) {
    return false;
  }
  return left.every((entry, index) => rustTargetTypeRefEqualsValidated(entry, right[index]!));
}

function stringListsEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) {
    return true;
  }
  return left !== undefined && right !== undefined && isDenseDataArray(left) && isDenseDataArray(right) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index]);
}

export function rustOptionTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustOptionTargetId, typeArguments: [value] };
}

export function rustJsValueTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsValueTargetId };
}

export function rustJsArrayTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayTargetId, typeArguments: [element] };
}

export function rustJsMapTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsMapTargetId, typeArguments: [key, value] };
}

export function rustJsSetTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsSetTargetId, typeArguments: [value] };
}

export function rustJsDateTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsDateTargetId };
}

export function isRustVecCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "array" }> {
  return carrier?.kind === "array";
}

export function isRustOptionCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustOptionTargetId;
}

export function rustOptionElementCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === rustOptionTargetId
    ? carrier.typeArguments?.[0]
    : undefined;
}

export function isRustJsArrayCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is TargetTypeRef & {
  readonly kind: "target-named";
  readonly id: typeof rustJsArrayTargetId;
  readonly typeArguments?: readonly TargetTypeRef[];
} {
  return carrier?.kind === "target-named" && carrier.id === rustJsArrayTargetId;
}

export function isRustJsValueCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustJsValueTargetId;
}

export function isRustStringCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustStringTargetId;
}

export function isRustUnitCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "tuple" && carrier.elements.length === 0;
}

export function isRustBoolCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && carrier.name === "bool";
}

const rustNumericPrimitiveNames: Readonly<Partial<Record<SourcePrimitiveKind, RustPrimitiveTypeName>>> = {
  int8: "i8",
  uint8: "u8",
  int16: "i16",
  uint16: "u16",
  int32: "i32",
  uint32: "u32",
  int64: "i64",
  uint64: "u64",
  float32: "f32",
  float64: "f64",
};

const rustSignedPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "int16",
  "int32",
  "int64",
  "float32",
  "float64",
]);

const rustIntegerPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
]);

export function rustPrimitiveTypeName(kind: SourcePrimitiveKind): RustPrimitiveTypeName | undefined {
  if (kind === "bool") {
    return "bool";
  }
  return rustNumericPrimitiveNames[kind];
}

export function isRustNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustNumericPrimitiveNames[carrier.name] !== undefined;
}

export function isRustSignedNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustSignedPrimitiveKinds.has(carrier.name);
}

export function isRustIntegerCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustIntegerPrimitiveKinds.has(carrier.name);
}

export function sameRustPrimitiveCarrier(left: TargetTypeRef | undefined, right: TargetTypeRef | undefined): boolean {
  return left?.kind === "source-primitive" && right?.kind === "source-primitive" && left.name === right.name;
}

export function rustSliceRefTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "pointer", pointee: { kind: "array", element }, mutability: "const" };
}

export function isRustSliceRefCarrier(carrier: TargetTypeRef | undefined): carrier is Extract<TargetTypeRef, { kind: "pointer" }> {
  return carrier?.kind === "pointer" && carrier.mutability === "const" && carrier.pointee.kind === "array";
}

export function rustSliceElementCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "pointer" && carrier.pointee.kind === "array" ? carrier.pointee.element : undefined;
}

export function rustSliceMutRefTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "pointer", pointee: { kind: "array", element }, mutability: "mut" };
}

export function isRustSliceMutRefCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "pointer" && carrier.mutability === "mut" && carrier.pointee.kind === "array";
}

export const rustFutureTargetId = "rust.core.Future";

export function rustNullishSourceTargetType(): TargetTypeRef {
  return { kind: "target-specific", target: "rust", name: "source-nullish" };
}

export function isRustNullishSourceCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-specific" &&
    carrier.target === "rust" &&
    carrier.name === "source-nullish";
}

export function rustFutureTargetType(output: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustFutureTargetId, typeArguments: [output] };
}

export function rustFutureOutputCarrier(carrier: TargetTypeRef | undefined): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === rustFutureTargetId
    ? carrier.typeArguments?.[0]
    : undefined;
}
