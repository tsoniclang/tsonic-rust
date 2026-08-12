import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { RustPrimitiveTypeName } from "../common/rust-syntax.js";
import { isDenseDataArray } from "../common/closed-metadata.js";
import {
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../policy/equality.js";
import type { TargetTypeRef } from "../policy/types.js";

export type { TargetTypeRef } from "../policy/types.js";

export type { RustPrimitiveTypeName } from "../common/rust-syntax.js";

// Rust carrier identities. Carriers are TargetTypeRefs selected by facts; the
// backend renders them to Rust type text only at the printer boundary.

export const rustStringTargetId = "rust.std.String";
export const rustBigIntTargetId = "rust.runtime.BigInt";
export const rustOptionTargetId = "rust.std.Option";
export const rustLocationTargetId = "rust.runtime.Location";
export const rustCallableTargetId = "rust.runtime.Callable";
export const rustGeneratorTargetId = "rust.runtime.Generator";
export const rustAsyncGeneratorTargetId = "rust.runtime.AsyncGenerator";
export const rustIteratorResultTargetId = "rust.runtime.IteratorResult";
export const rustUndefinedTargetId = "rust.runtime.Undefined";
export const rustJsValueTargetId = "rust.js.JsValue";
export const rustJsArrayTargetId = "rust.js.JsArray";
export const rustJsArrayConcatItemTargetId = "rust.js.JsArrayConcatItem";
export const rustJsMapTargetId = "rust.js.JsMap";
export const rustJsSetTargetId = "rust.js.JsSet";
export const rustJsDateTargetId = "rust.js.JsDate";
export const rustJsRegExpTargetId = "rust.js.JsRegExp";
export const rustJsRegExpMatchTargetId = "rust.js.JsRegExpMatch";
export const rustUsizeTargetId = "rust.core.usize";
export const rustIsizeTargetId = "rust.core.isize";
export const rustNamedTypeCarrierName = "named-type";

export interface RustSourceTypeCarrierValue {
  readonly fileName: string;
  readonly typeName: string;
  readonly shape: "object" | "enum";
  readonly typeArguments: readonly TargetTypeRef[];
}

export function rustSourceTypeCarrier(
  fileName: string,
  typeName: string,
  shape: "object" | "enum",
  typeArguments: readonly TargetTypeRef[] = [],
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: "source-type",
    value: { fileName, typeName, shape, typeArguments },
  };
}

export function rustSourceTypeCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustSourceTypeCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "source-type") {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys[0] !== "fileName" || keys[1] !== "shape" ||
    keys[2] !== "typeArguments" || keys[3] !== "typeName") {
    return undefined;
  }
  const candidate = value as {
    readonly fileName?: unknown;
    readonly typeName?: unknown;
    readonly shape?: unknown;
    readonly typeArguments?: unknown;
  };
  return typeof candidate.fileName === "string" && candidate.fileName.length > 0 &&
    typeof candidate.typeName === "string" && candidate.typeName.length > 0 &&
    (candidate.shape === "object" || candidate.shape === "enum") &&
    isDenseDataArray(candidate.typeArguments) &&
    candidate.typeArguments.every((argument) => isRustTargetTypeRef(argument))
    ? {
        fileName: candidate.fileName,
        typeName: candidate.typeName,
        shape: candidate.shape,
        typeArguments: candidate.typeArguments as readonly TargetTypeRef[],
      }
    : undefined;
}

export function rustSourcePrimitiveTargetType(kind: SourcePrimitiveKind): TargetTypeRef {
  return { kind: "source-primitive", name: kind };
}

export function rustStringTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustStringTargetId };
}

export function rustBigIntTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustBigIntTargetId };
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

export function rustUndefinedTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustUndefinedTargetId };
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
    case "closure":
      return {
        ...type,
        args: type.args.map((argument) => substituteRustTargetTypeParameters(argument, substitutions)),
        result: substituteRustTargetTypeParameters(type.result, substitutions),
      };
    case "associated-type":
      return { ...type, owner: substituteRustTargetTypeParameters(type.owner, substitutions) };
    case "target-specific": {
      const sourceType = rustSourceTypeCarrierValue(type);
      if (sourceType !== undefined) {
        return rustSourceTypeCarrier(
          sourceType.fileName,
          sourceType.typeName,
          sourceType.shape,
          sourceType.typeArguments.map((argument) =>
            substituteRustTargetTypeParameters(argument, substitutions)),
        );
      }
      const namedType = rustNamedTypeCarrierValue(type);
      if (namedType !== undefined) {
        return rustNamedTargetType(
          namedType.id,
          namedType.path,
          namedType.typeArguments.map((argument) =>
            substituteRustTargetTypeParameters(argument, substitutions)),
        );
      }
      const fixedArray = rustFixedArrayCarrierValue(type);
      return fixedArray === undefined
        ? type
        : rustFixedArrayTargetType(
            substituteRustTargetTypeParameters(fixedArray.element, substitutions),
            fixedArray.length,
          );
    }
    default:
      return type;
  }
}

export function rustTargetTypeContainsTypeParameter(
  type: TargetTypeRef,
  selectedNames: ReadonlySet<string>,
): boolean {
  return visitRustTargetTypeParameters(type, (name) => selectedNames.has(name));
}

export function rustTargetTypeParameterNames(type: TargetTypeRef): readonly string[] {
  const names = new Set<string>();
  visitRustTargetTypeParameters(type, (name) => {
    names.add(name);
    return false;
  });
  return Object.freeze([...names].sort());
}

function visitRustTargetTypeParameters(
  type: TargetTypeRef,
  visit: (name: string) => boolean,
): boolean {
  switch (type.kind) {
    case "type-parameter":
      return visit(type.name);
    case "target-named":
      return type.typeArguments?.some((argument) =>
        visitRustTargetTypeParameters(argument, visit)) === true;
    case "array":
      return visitRustTargetTypeParameters(type.element, visit);
    case "tuple":
      return type.elements.some((element) =>
        visitRustTargetTypeParameters(element, visit));
    case "pointer":
      return visitRustTargetTypeParameters(type.pointee, visit);
    case "function-pointer":
    case "closure":
      return type.args.some((argument) =>
        visitRustTargetTypeParameters(argument, visit)) ||
        visitRustTargetTypeParameters(type.result, visit);
    case "associated-type":
      return visitRustTargetTypeParameters(type.owner, visit);
    case "target-specific": {
      const sourceType = rustSourceTypeCarrierValue(type);
      if (sourceType !== undefined) {
        return sourceType.typeArguments.some((argument) =>
          visitRustTargetTypeParameters(argument, visit));
      }
      const namedType = rustNamedTypeCarrierValue(type);
      if (namedType !== undefined) {
        return namedType.typeArguments.some((argument) =>
          visitRustTargetTypeParameters(argument, visit));
      }
      const fixedArray = rustFixedArrayCarrierValue(type);
      return fixedArray !== undefined &&
        visitRustTargetTypeParameters(fixedArray.element, visit);
    }
    default:
      return false;
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
      case "closure":
        return right.kind === "closure" && left.args.length === right.args.length &&
          left.args.every((argument, index) => match(argument, right.args[index]!)) &&
          match(left.result, right.result);
      case "associated-type":
        return right.kind === "associated-type" && left.name === right.name && match(left.owner, right.owner);
      case "target-specific": {
        if (right.kind !== "target-specific") {
          return false;
        }
        const leftSource = rustSourceTypeCarrierValue(left);
        const rightSource = rustSourceTypeCarrierValue(right);
        if (leftSource !== undefined || rightSource !== undefined) {
          return leftSource !== undefined && rightSource !== undefined &&
            leftSource.fileName === rightSource.fileName &&
            leftSource.typeName === rightSource.typeName &&
            leftSource.shape === rightSource.shape &&
            leftSource.typeArguments.length === rightSource.typeArguments.length &&
            leftSource.typeArguments.every((argument, index) =>
              match(argument, rightSource.typeArguments[index]!));
        }
        const leftNamed = rustNamedTypeCarrierValue(left);
        const rightNamed = rustNamedTypeCarrierValue(right);
        if (leftNamed !== undefined || rightNamed !== undefined) {
          return leftNamed !== undefined && rightNamed !== undefined &&
            leftNamed.id === rightNamed.id &&
            leftNamed.path === rightNamed.path &&
            leftNamed.typeArguments.length === rightNamed.typeArguments.length &&
            leftNamed.typeArguments.every((argument, index) =>
              match(argument, rightNamed.typeArguments[index]!));
        }
        const leftArray = rustFixedArrayCarrierValue(left);
        const rightArray = rustFixedArrayCarrierValue(right);
        if (leftArray !== undefined || rightArray !== undefined) {
          return leftArray !== undefined && rightArray !== undefined &&
            leftArray.length === rightArray.length &&
            match(leftArray.element, rightArray.element);
        }
        return rustTargetTypeRefEquals(left, right);
      }
      default:
        return rustTargetTypeRefEquals(left, right);
    }
  }
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

export function rustLocationTargetType(pointee: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustLocationTargetId, typeArguments: [pointee] };
}

export function rustCallableTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustCallableTargetId,
    typeArguments: [rustTupleTargetType(parameters), result],
  };
}

export function rustCallableProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustCallableTargetId ||
    carrier.typeArguments?.length !== 2) {
    return undefined;
  }
  const [argumentsCarrier, result] = carrier.typeArguments;
  return argumentsCarrier?.kind === "tuple" && result !== undefined
    ? { parameters: argumentsCarrier.elements, result }
    : undefined;
}

export function rustClosureTargetType(
  parameters: readonly TargetTypeRef[],
  result: TargetTypeRef,
): TargetTypeRef {
  return { kind: "closure", args: parameters, result };
}

export function rustClosureProtocol(
  carrier: TargetTypeRef | undefined,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  return carrier?.kind === "closure"
    ? { parameters: carrier.args, result: carrier.result }
    : undefined;
}

export interface RustGeneratorProtocol {
  readonly kind: "sync" | "async";
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
  readonly nextType: TargetTypeRef;
}

export interface RustIteratorResultProtocol {
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
}

export function rustGeneratorTargetType(
  protocol: Omit<RustGeneratorProtocol, "kind">,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustGeneratorTargetId,
    typeArguments: [protocol.yieldType, protocol.returnType, protocol.nextType],
  };
}

export function rustAsyncGeneratorTargetType(
  protocol: Omit<RustGeneratorProtocol, "kind">,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustAsyncGeneratorTargetId,
    typeArguments: [protocol.yieldType, protocol.returnType, protocol.nextType],
  };
}

export function rustIteratorResultTargetType(
  protocol: RustIteratorResultProtocol,
): TargetTypeRef {
  return {
    kind: "target-named",
    id: rustIteratorResultTargetId,
    typeArguments: [protocol.yieldType, protocol.returnType],
  };
}

export function getRustGeneratorProtocol(
  carrier: TargetTypeRef | undefined,
): RustGeneratorProtocol | undefined {
  if (carrier?.kind !== "target-named" ||
    (carrier.id !== rustGeneratorTargetId && carrier.id !== rustAsyncGeneratorTargetId) ||
    carrier.typeArguments?.length !== 3) {
    return undefined;
  }
  const [yieldType, returnType, nextType] = carrier.typeArguments;
  return yieldType === undefined || returnType === undefined || nextType === undefined
    ? undefined
    : {
        kind: carrier.id === rustGeneratorTargetId ? "sync" : "async",
        yieldType,
        returnType,
        nextType,
      };
}

export function getRustIteratorResultProtocol(
  carrier: TargetTypeRef | undefined,
): RustIteratorResultProtocol | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustIteratorResultTargetId ||
    carrier.typeArguments?.length !== 2) {
    return undefined;
  }
  const [yieldType, returnType] = carrier.typeArguments;
  return yieldType === undefined || returnType === undefined
    ? undefined
    : { yieldType, returnType };
}

export function rustLocationPointeeCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" &&
      carrier.id === rustLocationTargetId &&
      carrier.typeArguments?.length === 1
    ? carrier.typeArguments[0]
    : undefined;
}

export function rustOptionalLocationPointeeCarrier(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const optionalValue = rustOptionElementCarrier(carrier);
  return rustLocationPointeeCarrier(optionalValue ?? carrier);
}

export function isRustLocationCarrier(
  carrier: TargetTypeRef | undefined,
): boolean {
  return rustLocationPointeeCarrier(carrier) !== undefined;
}

export function rustJsValueTargetType(): TargetTypeRef {
  return { kind: "target-named", id: rustJsValueTargetId };
}

export function rustJsArrayTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayTargetId, typeArguments: [element] };
}

export function rustJsArrayConcatItemTargetType(element: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsArrayConcatItemTargetId, typeArguments: [element] };
}

export function rustJsMapTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsMapTargetId, typeArguments: [key, value] };
}

export function rustJsSetTargetType(value: TargetTypeRef): TargetTypeRef {
  return { kind: "target-named", id: rustJsSetTargetId, typeArguments: [value] };
}

export function getRustJsMapTargetTypes(
  carrier: TargetTypeRef | undefined,
): { readonly key: TargetTypeRef; readonly value: TargetTypeRef } | undefined {
  if (carrier?.kind !== "target-named" || carrier.id !== rustJsMapTargetId ||
    carrier.typeArguments?.length !== 2) {
    return undefined;
  }
  const [key, value] = carrier.typeArguments;
  return key === undefined || value === undefined ? undefined : { key, value };
}

export function getRustJsSetElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  return carrier?.kind === "target-named" && carrier.id === rustJsSetTargetId &&
    carrier.typeArguments?.length === 1
    ? carrier.typeArguments[0]
    : undefined;
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

export function isRustBigIntCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustBigIntTargetId;
}

export function isRustUnitCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "tuple" && carrier.elements.length === 0;
}

export function isRustUndefinedCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && carrier.id === rustUndefinedTargetId;
}

export function isRustBoolCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && carrier.name === "bool";
}

export function isRustCopyCarrier(carrier: TargetTypeRef | undefined): boolean {
  if (carrier === undefined) {
    return false;
  }
  if (carrier.kind === "source-primitive" || carrier.kind === "function-pointer") {
    return true;
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.every(isRustCopyCarrier);
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  if (fixedArray !== undefined) {
    return isRustCopyCarrier(fixedArray.element);
  }
  return rustSourceTypeCarrierValue(carrier)?.shape === "enum";
}

export function rustValueCarrierRequiresCloneOnRead(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && rustCloneOnReadTargetIds.has(carrier.id) ||
    rustSourceTypeCarrierValue(carrier)?.shape === "object";
}

export function isRustJsStrictEqualityCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && rustJsStrictEqualityTargetIds.has(carrier.id);
}

export function rustCarrierSupportsClone(carrier: TargetTypeRef | undefined): boolean {
  if (carrier === undefined || carrier.kind === "type-parameter" ||
    carrier.kind === "associated-type" || carrier.kind === "lifetime" ||
    carrier.kind === "opaque" || carrier.kind === "pointer" || carrier.kind === "closure") {
    return false;
  }
  if (carrier.kind === "source-primitive" || carrier.kind === "function-pointer") {
    return true;
  }
  if (carrier.kind === "array") {
    return rustCarrierSupportsClone(carrier.element);
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.every(rustCarrierSupportsClone);
  }
  if (carrier.kind === "target-named") {
    if (carrier.id === rustOptionTargetId) {
      const [value] = carrier.typeArguments ?? [];
      return value !== undefined && rustCarrierSupportsClone(value);
    }
    return rustUnconditionallyCloneTargetIds.has(carrier.id);
  }
  const fixedArray = rustFixedArrayCarrierValue(carrier);
  return fixedArray !== undefined
    ? rustCarrierSupportsClone(fixedArray.element)
    : carrier.target === "rust" && carrier.name === "source-type";
}

export function rustCarrierSupportsJsEquality(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" || isRustStringCarrier(carrier) ||
    isRustBigIntCarrier(carrier) || isRustUndefinedCarrier(carrier) ||
    isRustJsStrictEqualityCarrier(carrier);
}

const rustCloneOnReadTargetIds: ReadonlySet<string> = new Set([
  rustBigIntTargetId,
  rustCallableTargetId,
  rustLocationTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsRegExpTargetId,
]);

const rustJsStrictEqualityTargetIds: ReadonlySet<string> = new Set([
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsRegExpTargetId,
]);

const rustUnconditionallyCloneTargetIds: ReadonlySet<string> = new Set([
  rustStringTargetId,
  rustBigIntTargetId,
  rustCallableTargetId,
  rustLocationTargetId,
  rustUndefinedTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsRegExpTargetId,
  rustJsRegExpMatchTargetId,
]);

export function isRustSourceStringConvertibleCarrier(carrier: TargetTypeRef | undefined): boolean {
  return isRustStringCarrier(carrier) || isRustUnitCarrier(carrier) ||
    isRustUndefinedCarrier(carrier) || isRustBigIntCarrier(carrier) ||
    carrier?.kind === "source-primitive";
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
  "native-int": "isize",
  "native-uint": "usize",
};

const rustSignedPrimitiveKinds: ReadonlySet<SourcePrimitiveKind> = new Set([
  "int8",
  "int16",
  "int32",
  "int64",
  "float32",
  "float64",
  "native-int",
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
  "native-int",
  "native-uint",
]);

export function rustPrimitiveTypeName(kind: SourcePrimitiveKind): RustPrimitiveTypeName | undefined {
  if (kind === "bool") {
    return "bool";
  }
  return rustNumericPrimitiveNames[kind];
}

export function isRustNumericCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is Extract<TargetTypeRef, { readonly kind: "source-primitive" }> {
  return carrier?.kind === "source-primitive" && rustNumericPrimitiveNames[carrier.name] !== undefined;
}

export function isRustSignedNumericCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && rustSignedPrimitiveKinds.has(carrier.name);
}

export function isRustIntegerCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is Extract<TargetTypeRef, { readonly kind: "source-primitive" }> {
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
