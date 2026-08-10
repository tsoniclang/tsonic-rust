import {
  closedMetadataEquals,
  isClosedMetadata,
  isDenseDataArray,
} from "../common/closed-metadata.js";
import type {
  RustSelectedTargetOperation,
  RustSelectedTargetSignature,
  RustTargetTypeRef,
} from "./types.js";

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
        targetTypeRefListsEqual(left.typeArguments, right.typeArguments);
    case "type-parameter":
    case "lifetime":
      return right.kind === left.kind && left.name === right.name;
    case "opaque":
      return right.kind === left.kind && left.id === right.id;
    case "array":
      return right.kind === left.kind && left.rank === right.rank &&
        rustTargetTypeRefEqualsValidated(left.element, right.element);
    case "tuple":
      return right.kind === left.kind && targetTypeRefListsEqual(left.elements, right.elements);
    case "pointer":
      return right.kind === left.kind && left.mutability === right.mutability &&
        rustTargetTypeRefEqualsValidated(left.pointee, right.pointee);
    case "function-pointer":
      return right.kind === left.kind &&
        stringListsEqual(left.abi, right.abi) &&
        targetTypeRefListsEqual(left.args, right.args) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result);
    case "associated-type":
      return right.kind === left.kind && left.name === right.name &&
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
        return hasExactKeys(value, ["kind", "id", "typeArguments"], ["kind", "id"]) &&
          typeof value.id === "string" && value.id.length > 0 &&
          (value.typeArguments === undefined || validateChildren(value.typeArguments));
      case "type-parameter":
      case "lifetime":
        return hasExactKeys(value, ["kind", "name"], ["kind", "name"]) &&
          typeof value.name === "string" && value.name.length > 0;
      case "array":
        return hasExactKeys(value, ["kind", "element", "rank"], ["kind", "element"]) &&
          validateChild(value.element) &&
          (value.rank === undefined || (Number.isSafeInteger(value.rank) && (value.rank as number) > 0));
      case "tuple":
        return hasExactKeys(value, ["kind", "elements"], ["kind", "elements"]) &&
          validateChildren(value.elements);
      case "pointer":
        return hasExactKeys(value, ["kind", "pointee", "mutability"], ["kind", "pointee"]) &&
          validateChild(value.pointee) &&
          (value.mutability === undefined || value.mutability === "const" || value.mutability === "mut" ||
            value.mutability === "target-defined");
      case "function-pointer":
        return hasExactKeys(value, ["kind", "args", "result", "abi"], ["kind", "args", "result"]) &&
          validateChildren(value.args) && validateChild(value.result) &&
          (value.abi === undefined ||
            (isDenseDataArray(value.abi) && value.abi.every((part) => typeof part === "string")));
      case "opaque":
        return hasExactKeys(value, ["kind", "id"], ["kind", "id"]) &&
          typeof value.id === "string" && value.id.length > 0;
      case "associated-type":
        return hasExactKeys(value, ["kind", "owner", "name"], ["kind", "owner", "name"]) &&
          validateChild(value.owner) && typeof value.name === "string" && value.name.length > 0;
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
