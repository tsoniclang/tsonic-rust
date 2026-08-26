import {
  closedMetadataEquals,
  isClosedMetadata,
  isDenseDataArray,
} from "../metadata/closed-data.js";
import type {
  RustSelectedTargetOperation,
  RustSelectedTargetSignature,
  RustTargetTypeRef,
} from "../../target-model/types/model.js";
import {
  rustLifetimesEqual,
} from "../lifetimes/index.js";
import type {
  RustLifetimeBinder,
  RustLifetimeRef,
} from "../lifetimes/index.js";

export function rustTargetTypeRefEquals(
  left: RustTargetTypeRef | undefined,
  right: RustTargetTypeRef | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (!isRustTargetTypeRef(left) || !isRustTargetTypeRef(right)) {
    return false;
  }
  return rustTargetTypeRefEqualsValidated(left, right);
}

export function isRustTargetTypeRef(value: unknown): value is RustTargetTypeRef {
  try {
    return validateRustTargetTypeRef(value, new WeakSet<object>(), 0);
  } catch {
    return false;
  }
}

export function rustSelectedTargetOperationEquals(
  left: RustSelectedTargetOperation,
  right: RustSelectedTargetOperation,
): boolean {
  return left.operationId === right.operationId &&
    left.operationKind === right.operationKind &&
    left.targetOperation === right.targetOperation &&
    rustTargetTypeRefEquals(left.resultType, right.resultType) &&
    closedMetadataEquals(left.providerDeclaration, right.providerDeclaration) &&
    operationProvenanceEquals(left.provenance, right.provenance);
}

export function rustSelectedTargetSignatureEquals(
  left: RustSelectedTargetSignature,
  right: RustSelectedTargetSignature,
): boolean {
  return closedMetadataEquals(left.member, right.member) &&
    rustTargetTypeRefEquals(
      left.sourceSelectedReceiverCarrier,
      right.sourceSelectedReceiverCarrier,
    ) &&
    rustTargetTypeRefEquals(
      left.sourceCallableCarrier,
      right.sourceCallableCarrier,
    ) &&
    closedMetadataEquals(
      left.sourceCallableParameterIndexes,
      right.sourceCallableParameterIndexes,
    ) &&
    closedMetadataEquals(
      left.sourceStructuralMethod,
      right.sourceStructuralMethod,
    ) &&
    closedMetadataEquals(left.targetTypeArguments, right.targetTypeArguments) &&
    closedMetadataEquals(left.providerDeclaration, right.providerDeclaration) &&
    closedMetadataEquals(left.argumentConversions, right.argumentConversions) &&
    left.sourceSignature === right.sourceSignature &&
    left.sourceDeclaration === right.sourceDeclaration &&
    left.sourceCalleeSymbol === right.sourceCalleeSymbol &&
    left.sourceCalleeDeclaration === right.sourceCalleeDeclaration &&
    left.sourceReturnType === right.sourceReturnType &&
    sourceArgumentBindingsEqual(left.sourceArgumentBindings, right.sourceArgumentBindings) &&
    sourceSelectedSignatureParametersEqual(
      left.sourceSelectedSignatureParameters,
      right.sourceSelectedSignatureParameters,
    ) &&
    sourceSelectedMethodTypeArgumentsEqual(
      left.sourceSelectedMethodTypeArguments,
      right.sourceSelectedMethodTypeArguments,
    );
}

function operationProvenanceEquals(
  left: RustSelectedTargetOperation["provenance"],
  right: RustSelectedTargetOperation["provenance"],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.sourceExpression === right.sourceExpression &&
    left.sourceReceiver === right.sourceReceiver &&
    left.sourceCallee === right.sourceCallee &&
    left.sourceSelectedSignature === right.sourceSelectedSignature &&
    left.sourceSelectedSymbol === right.sourceSelectedSymbol &&
    left.sourceSelectedDeclaration === right.sourceSelectedDeclaration &&
    left.sourceSelectedReadDeclaration === right.sourceSelectedReadDeclaration &&
    left.sourceSelectedWriteDeclaration === right.sourceSelectedWriteDeclaration &&
    left.sourceCalleeSymbol === right.sourceCalleeSymbol &&
    left.sourceCalleeDeclaration === right.sourceCalleeDeclaration &&
    left.sourceResultType === right.sourceResultType &&
    left.sourceReturnType === right.sourceReturnType &&
    closedMetadataEquals(left.providerDeclaration, right.providerDeclaration);
}

function sourceArgumentBindingsEqual(
  left: RustSelectedTargetSignature["sourceArgumentBindings"],
  right: RustSelectedTargetSignature["sourceArgumentBindings"],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.sourceArgumentIndex === other.sourceArgumentIndex &&
      entry.effectiveArgumentIndex === other.effectiveArgumentIndex &&
      entry.sourceForm === other.sourceForm &&
      entry.spreadElementIndex === other.spreadElementIndex &&
      entry.sourceParameterIndex === other.sourceParameterIndex &&
      entry.sourceParameterForm === other.sourceParameterForm &&
      entry.selectedArgumentType === other.selectedArgumentType &&
      entry.selectedParameterType === other.selectedParameterType;
  });
}

function sourceSelectedSignatureParametersEqual(
  left: RustSelectedTargetSignature["sourceSelectedSignatureParameters"],
  right: RustSelectedTargetSignature["sourceSelectedSignatureParameters"],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.parameterIndex === other.parameterIndex &&
      entry.parameterName === other.parameterName &&
      entry.parameterSymbol === other.parameterSymbol &&
      entry.parameterDeclaration === other.parameterDeclaration &&
      entry.selectedType === other.selectedType &&
      entry.authoredTypeNode === other.authoredTypeNode &&
      entry.acceptsOmission === other.acceptsOmission &&
      entry.rest === other.rest;
  });
}

function sourceSelectedMethodTypeArgumentsEqual(
  left: RustSelectedTargetSignature["sourceSelectedMethodTypeArguments"],
  right: RustSelectedTargetSignature["sourceSelectedMethodTypeArguments"],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.typeParameterName === other.typeParameterName &&
      entry.typeParameter === other.typeParameter &&
      entry.selectedType === other.selectedType &&
      entry.explicitTypeNode === other.explicitTypeNode;
  });
}

function rustTargetTypeRefEqualsValidated(
  left: RustTargetTypeRef,
  right: RustTargetTypeRef,
): boolean {
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
      return right.kind === left.kind && left.id === right.id &&
        lifetimeListsEqual(left.lifetimeArguments, right.lifetimeArguments) &&
        targetTypeRefListsEqual(left.typeArguments, right.typeArguments);
    case "type-parameter":
      return right.kind === left.kind && left.name === right.name;
    case "opaque":
      return right.kind === left.kind && left.id === right.id;
    case "array":
      return right.kind === left.kind && left.rank === right.rank &&
        rustTargetTypeRefEqualsValidated(left.element, right.element);
    case "slice":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.element, right.element);
    case "tuple":
      return right.kind === left.kind && targetTypeRefListsEqual(left.elements, right.elements);
    case "reference":
      return right.kind === left.kind && left.mutable === right.mutable &&
        rustLifetimesEqual(left.lifetime, right.lifetime) &&
        rustTargetTypeRefEqualsValidated(left.referent, right.referent);
    case "pointer":
      return right.kind === left.kind && left.mutability === right.mutability &&
        rustTargetTypeRefEqualsValidated(left.pointee, right.pointee);
    case "function-pointer":
      return right.kind === left.kind &&
        lifetimeBindersEqual(left.lifetimeBinder, right.lifetimeBinder) &&
        stringListsEqual(left.abi, right.abi) &&
        left.isUnsafe === right.isUnsafe &&
        targetTypeRefListsEqual(left.args, right.args) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result);
    case "closure":
      return right.kind === left.kind &&
        lifetimeBindersEqual(left.lifetimeBinder, right.lifetimeBinder) &&
        targetTypeRefListsEqual(left.args, right.args) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result);
    case "trait-object":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.principal, right.principal) &&
        targetTypeRefListsEqual(left.autoTraits, right.autoTraits) &&
        rustLifetimesEqual(left.lifetime, right.lifetime);
    case "impl-trait":
      return right.kind === left.kind && left.id === right.id &&
        targetTypeRefListsEqual(left.bounds, right.bounds) &&
        lifetimeListsEqual(left.captures, right.captures);
    case "associated-type":
      return right.kind === left.kind && left.name === right.name &&
        lifetimeListsEqual(left.lifetimeArguments, right.lifetimeArguments) &&
        targetTypeRefListsEqual(left.typeArguments, right.typeArguments) &&
        rustTargetTypeRefEqualsValidated(left.owner, right.owner);
    case "target-specific":
      return right.kind === left.kind && left.target === right.target && left.name === right.name &&
        closedMetadataEquals(left.value, right.value);
  }
}

function validateRustTargetTypeRef(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): value is RustTargetTypeRef {
  if (!isPlainRecord(value) || depth > 128 || active.has(value)) {
    return false;
  }
  active.add(value);
  try {
    const validateChild = (child: unknown): child is RustTargetTypeRef =>
      validateRustTargetTypeRef(child, active, depth + 1);
    const validateChildren = (children: unknown): children is readonly RustTargetTypeRef[] =>
      isDenseDataArray(children) && children.every(validateChild);
    switch (value.kind) {
      case "source-primitive":
        return hasExactKeys(value, ["kind", "name"], ["kind", "name"]) &&
          sourcePrimitiveNames.has(value.name);
      case "target-named":
        return hasExactKeys(
          value,
          ["kind", "id", "lifetimeArguments", "typeArguments"],
          ["kind", "id"],
        ) &&
          typeof value.id === "string" && value.id.length > 0 &&
          (value.lifetimeArguments === undefined ||
            validateLifetimeList(value.lifetimeArguments)) &&
          (value.typeArguments === undefined || validateChildren(value.typeArguments));
      case "type-parameter":
        return hasExactKeys(value, ["kind", "name"], ["kind", "name"]) &&
          typeof value.name === "string" && value.name.length > 0;
      case "array":
        return hasExactKeys(value, ["kind", "element", "rank"], ["kind", "element"]) &&
          validateChild(value.element) &&
          (value.rank === undefined || (Number.isSafeInteger(value.rank) && (value.rank as number) > 0));
      case "slice":
        return hasExactKeys(value, ["kind", "element"], ["kind", "element"]) &&
          validateChild(value.element);
      case "tuple":
        return hasExactKeys(value, ["kind", "elements"], ["kind", "elements"]) &&
          validateChildren(value.elements);
      case "reference":
        return hasExactKeys(value, ["kind", "referent", "mutable", "lifetime"], ["kind", "referent", "mutable"]) &&
          validateChild(value.referent) && typeof value.mutable === "boolean" &&
          (value.lifetime === undefined || validateLifetime(value.lifetime));
      case "pointer":
        return hasExactKeys(value, ["kind", "pointee", "mutability"], ["kind", "pointee"]) &&
          validateChild(value.pointee) &&
          (value.mutability === undefined || value.mutability === "const" || value.mutability === "mut" ||
            value.mutability === "target-defined");
      case "function-pointer":
        return hasExactKeys(
          value,
          ["kind", "args", "result", "lifetimeBinder", "abi", "isUnsafe"],
          ["kind", "args", "result"],
        ) &&
          validateChildren(value.args) && validateChild(value.result) &&
          (value.lifetimeBinder === undefined || validateLifetimeBinder(value.lifetimeBinder)) &&
          (value.isUnsafe === undefined || typeof value.isUnsafe === "boolean") &&
          (value.abi === undefined ||
            (isDenseDataArray(value.abi) && value.abi.every((part) => typeof part === "string")));
      case "closure":
        return hasExactKeys(
          value,
          ["kind", "args", "result", "lifetimeBinder"],
          ["kind", "args", "result"],
        ) && validateChildren(value.args) && validateChild(value.result) &&
          (value.lifetimeBinder === undefined || validateLifetimeBinder(value.lifetimeBinder));
      case "opaque":
        return hasExactKeys(value, ["kind", "id"], ["kind", "id"]) &&
          typeof value.id === "string" && value.id.length > 0;
      case "trait-object":
        return hasExactKeys(
          value,
          ["kind", "principal", "autoTraits", "lifetime"],
          ["kind", "principal", "autoTraits"],
        ) && validateChild(value.principal) && validateChildren(value.autoTraits) &&
          (value.lifetime === undefined || validateLifetime(value.lifetime));
      case "impl-trait":
        return hasExactKeys(
          value,
          ["kind", "id", "bounds", "captures"],
          ["kind", "id", "bounds", "captures"],
        ) && typeof value.id === "string" && value.id.length > 0 &&
          validateChildren(value.bounds) && validateLifetimeList(value.captures);
      case "associated-type":
        return hasExactKeys(
          value,
          ["kind", "owner", "name", "lifetimeArguments", "typeArguments"],
          ["kind", "owner", "name"],
        ) && validateChild(value.owner) &&
          typeof value.name === "string" && value.name.length > 0 &&
          (value.lifetimeArguments === undefined ||
            validateLifetimeList(value.lifetimeArguments)) &&
          (value.typeArguments === undefined || validateChildren(value.typeArguments));
      case "target-specific":
        return hasExactKeys(value, ["kind", "target", "name", "value"], ["kind", "target", "name"]) &&
          value.target === "rust" && typeof value.name === "string" && value.name.length > 0 &&
          (!Object.prototype.hasOwnProperty.call(value, "value") || isClosedMetadata(value.value));
      default:
        return false;
    }
  } finally {
    active.delete(value);
  }
}

function validateLifetime(value: unknown): value is RustLifetimeRef {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "static":
    case "placeholder":
      return hasExactKeys(value, ["kind"], ["kind"]);
    case "parameter":
      return hasExactKeys(
        value,
        ["kind", "identity", "name"],
        ["kind", "identity", "name"],
      ) && nonEmptyString(value.identity) && nonEmptyString(value.name);
    case "bound":
      return hasExactKeys(
        value,
        ["kind", "binderIdentity", "identity", "name"],
        ["kind", "binderIdentity", "identity", "name"],
      ) && nonEmptyString(value.binderIdentity) &&
        nonEmptyString(value.identity) && nonEmptyString(value.name);
    default:
      return false;
  }
}

function validateLifetimeList(value: unknown): value is readonly RustLifetimeRef[] {
  return isDenseDataArray(value) && value.every(validateLifetime);
}

function validateLifetimeBinder(value: unknown): value is RustLifetimeBinder {
  return isPlainRecord(value) &&
    hasExactKeys(value, ["identity", "parameters"], ["identity", "parameters"]) &&
    nonEmptyString(value.identity) && validateLifetimeList(value.parameters) &&
    value.parameters.every((parameter) => parameter.kind === "bound");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
  left: readonly RustTargetTypeRef[] | undefined,
  right: readonly RustTargetTypeRef[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined || left.length !== right.length ||
    !isDenseDataArray(left) || !isDenseDataArray(right)) {
    return false;
  }
  return left.every((entry, index) => rustTargetTypeRefEqualsValidated(entry, right[index]!));
}

function stringListsEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  return left !== undefined && right !== undefined && isDenseDataArray(left) && isDenseDataArray(right) &&
    left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function lifetimeListsEqual(
  left: readonly RustLifetimeRef[] | undefined,
  right: readonly RustLifetimeRef[] | undefined,
): boolean {
  if (left === right) return true;
  return left !== undefined && right !== undefined &&
    left.length === right.length &&
    left.every((entry, index) => rustLifetimesEqual(entry, right[index]));
}

function lifetimeBindersEqual(
  left: RustLifetimeBinder | undefined,
  right: RustLifetimeBinder | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.identity === right.identity &&
      lifetimeListsEqual(left.parameters, right.parameters);
}
