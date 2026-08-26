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
import type { RustTraitRef } from "../semantics/index.js";
import type {
  RustBound,
  RustCapturedGeneric,
  RustConstExpr,
  RustGenericArgument,
  RustLifetimeRef,
} from "../semantics/index.js";
import {
  compareRustCapturedGenerics,
  rustCapturedGenericSemanticKey,
  rustGenericArgumentSemanticKey,
  rustSemanticIdentityKey,
  rustSemanticIdentitiesEqual,
} from "../semantics/index.js";
import { singleRustUnicodeScalar } from "../syntax/literals.js";

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

export function isRustBoundValue(value: unknown): value is RustBound {
  return isClosedMetadata(value) && isRustBound(value, new WeakSet(), 0);
}

export function isRustTargetTypeRef(value: unknown): value is RustTargetTypeRef {
  try {
    return validateRustTargetTypeRef(value, new WeakSet<object>(), 0);
  } catch {
    return false;
  }
}

export function isRustTraitReference(value: unknown): value is RustTraitRef {
  try {
    return isRustTraitRef(value, new WeakSet<object>(), 0);
  } catch {
    return false;
  }
}

export function isRustBinderValue(value: unknown): value is import("../semantics/index.js").RustBinder {
  return isRustBinder(value, new WeakSet<object>(), 0);
}

export function isRustLifetimeValue(value: unknown): value is RustLifetimeRef {
  return isRustLifetime(value);
}

export function isRustGenericArgumentValue(
  value: unknown,
): value is import("../semantics/index.js").RustGenericArgument {
  return isRustGenericArgument(value, new WeakSet<object>(), 0);
}

export function rustTraitReferenceEquals(
  left: RustTraitRef | undefined,
  right: RustTraitRef | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return isRustTraitReference(left) && isRustTraitReference(right) &&
    rustTraitRefsEqualValidated(left, right);
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
    optionalGenericArgumentListsEqual(
      left.targetGenericArguments,
      right.targetGenericArguments,
    ) &&
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

function optionalGenericArgumentListsEqual(
  left: readonly RustGenericArgument[] | undefined,
  right: readonly RustGenericArgument[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((argument, index) => {
    const other = right[index];
    return other !== undefined &&
      rustGenericArgumentSemanticKey(argument) === rustGenericArgumentSemanticKey(other);
  });
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
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "source-primitive":
    case "primitive":
      return right.kind === left.kind && left.name === right.name;
    case "never":
    case "unit":
    case "str":
      return true;
    case "self":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.owner, right.owner);
    case "type-parameter":
    case "inference-variable":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.identity, right.identity);
    case "tuple":
      return right.kind === left.kind &&
        targetTypeRefListsEqual(left.elements, right.elements);
    case "array":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.element, right.element) &&
        rustConstExprsEqual(left.length, right.length);
    case "sequence":
    case "slice":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.element, right.element);
    case "path":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.identity, right.identity) &&
        rustGenericArgumentsEqual(left.arguments, right.arguments);
    case "reference":
      return right.kind === left.kind && left.mutable === right.mutable &&
        rustLifetimesEqual(left.lifetime, right.lifetime) &&
        rustTargetTypeRefEqualsValidated(left.target, right.target);
    case "raw-pointer":
      return right.kind === left.kind && left.mutable === right.mutable &&
        rustTargetTypeRefEqualsValidated(left.target, right.target);
    case "function-pointer":
      return right.kind === left.kind && left.safety === right.safety &&
        left.abi === right.abi && left.variadic === right.variadic &&
        rustBindersEqual(left.binder, right.binder) &&
        targetTypeRefListsEqual(left.parameters, right.parameters) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result);
    case "closure":
      return right.kind === left.kind && left.callTrait === right.callTrait &&
        rustBindersEqual(left.binder, right.binder) &&
        targetTypeRefListsEqual(left.parameters, right.parameters) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result) &&
        capturedGenericListsEqual(left.captures, right.captures);
    case "trait-object":
      return right.kind === left.kind &&
        rustTraitRefsEqualValidated(left.principal, right.principal) &&
        traitRefListsEqual(left.autoTraits, right.autoTraits) &&
        rustLifetimesEqual(left.lifetime, right.lifetime);
    case "opaque":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.identity, right.identity) &&
        boundListsEqual(left.bounds, right.bounds) &&
        capturedGenericListsEqual(left.captures, right.captures);
    case "associated-type":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.owner, right.owner) &&
        rustTraitRefsEqualValidated(left.trait, right.trait) &&
        rustSemanticIdentitiesEqual(left.item, right.item) &&
        rustGenericArgumentsEqual(left.arguments, right.arguments);
    case "source-carrier":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.identity, right.identity) &&
        closedMetadataEquals(left.payload, right.payload);
  }
}

function rustLifetimesEqual(
  left: RustLifetimeRef,
  right: RustLifetimeRef,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "static":
      return true;
    case "parameter":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.identity, right.identity);
    case "bound":
      return right.kind === left.kind && left.binderId === right.binderId &&
        left.parameterId === right.parameterId;
    case "inferred-region":
      return right.kind === left.kind && left.regionId === right.regionId;
  }
}

function rustConstExprsEqual(left: RustConstExpr, right: RustConstExpr): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "literal":
      return right.kind === left.kind && left.literalKind === right.literalKind &&
        left.value === right.value;
    case "parameter":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.identity, right.identity);
    case "item":
      return right.kind === left.kind &&
        rustSemanticIdentitiesEqual(left.identity, right.identity);
    case "unary":
      return right.kind === left.kind && left.operator === right.operator &&
        rustConstExprsEqual(left.operand, right.operand);
    case "binary":
      return right.kind === left.kind && left.operator === right.operator &&
        rustConstExprsEqual(left.left, right.left) &&
        rustConstExprsEqual(left.right, right.right);
    case "inferred":
      return true;
  }
}

function rustGenericArgumentsEqual(
  left: readonly RustGenericArgument[],
  right: readonly RustGenericArgument[],
): boolean {
  return left.length === right.length && left.every((argument, index) => {
    const other = right[index];
    if (other === undefined || argument.kind !== other.kind) return false;
    if (argument.kind === "lifetime") {
      return other.kind === argument.kind &&
        rustLifetimesEqual(argument.value, other.value);
    }
    if (argument.kind === "type") {
      return other.kind === argument.kind &&
        rustTargetTypeRefEqualsValidated(argument.value, other.value);
    }
    return other.kind === argument.kind &&
      rustConstExprsEqual(argument.value, other.value);
  });
}

function rustTraitRefsEqualValidated(left: RustTraitRef, right: RustTraitRef): boolean {
  return rustSemanticIdentitiesEqual(left.identity, right.identity) &&
    rustGenericArgumentsEqual(left.arguments, right.arguments) &&
    left.associatedConstraints.length === right.associatedConstraints.length &&
    left.associatedConstraints.every((constraint, index) => {
      const other = right.associatedConstraints[index];
      if (other === undefined || constraint.kind !== other.kind ||
        !rustSemanticIdentitiesEqual(constraint.item, other.item) ||
        !rustGenericArgumentsEqual(constraint.arguments, other.arguments)) {
        return false;
      }
      return constraint.kind === "equality"
        ? other.kind === constraint.kind &&
          rustTargetTypeRefEqualsValidated(constraint.type, other.type)
        : other.kind === constraint.kind &&
          boundListsEqual(constraint.bounds, other.bounds);
    });
}

function traitRefListsEqual(
  left: readonly RustTraitRef[],
  right: readonly RustTraitRef[],
): boolean {
  return left.length === right.length && left.every((trait, index) => {
    const other = right[index];
    return other !== undefined && rustTraitRefsEqualValidated(trait, other);
  });
}

function rustBindersEqual(
  left: import("../semantics/index.js").RustBinder | undefined,
  right: import("../semantics/index.js").RustBinder | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.id === right.id && left.lifetimes.length === right.lifetimes.length &&
    left.lifetimes.every((parameter, index) => {
      const other = right.lifetimes[index];
      return other !== undefined &&
        rustLifetimesEqual(parameter.identity, other.identity) &&
        parameter.bounds.length === other.bounds.length &&
        parameter.bounds.every((bound, boundIndex) =>
          rustLifetimesEqual(bound, other.bounds[boundIndex]!));
    });
}

function boundListsEqual(
  left: readonly RustBound[],
  right: readonly RustBound[],
): boolean {
  return left.length === right.length && left.every((bound, index) => {
    const other = right[index];
    return other !== undefined && rustBoundsEqual(bound, other);
  });
}

function rustBoundsEqual(left: RustBound, right: RustBound): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "trait":
      return right.kind === left.kind && left.polarity === right.polarity &&
        rustBindersEqual(left.binder, right.binder) &&
        rustTraitRefsEqualValidated(left.trait, right.trait);
    case "lifetime-outlives":
      return right.kind === left.kind &&
        rustLifetimesEqual(left.longer, right.longer) &&
        rustLifetimesEqual(left.shorter, right.shorter);
    case "type-outlives":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.type, right.type) &&
        rustLifetimesEqual(left.lifetime, right.lifetime);
    case "associated-equality":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.projection, right.projection) &&
        rustTargetTypeRefEqualsValidated(left.value, right.value);
  }
}

function capturedGenericListsEqual(
  left: readonly RustCapturedGeneric[],
  right: readonly RustCapturedGeneric[],
): boolean {
  return left.length === right.length && left.every((capture, index) => {
    const other = right[index];
    if (other === undefined || capture.kind !== other.kind) return false;
    return capture.kind === "lifetime"
      ? other.kind === capture.kind && rustLifetimesEqual(capture.value, other.value)
      : other.kind === capture.kind &&
        rustSemanticIdentitiesEqual(capture.identity, other.identity);
  });
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
      case "primitive":
        return hasExactKeys(value, ["kind", "name"], ["kind", "name"]) &&
          rustPrimitiveNames.has(value.name);
      case "never":
      case "unit":
      case "str":
        return hasExactKeys(value, ["kind"], ["kind"]);
      case "self":
        return hasExactKeys(value, ["kind", "owner"], ["kind", "owner"]) &&
          isRustSemanticIdentity(value.owner);
      case "type-parameter":
        return hasExactKeys(
          value,
          ["kind", "identity", "displayName"],
          ["kind", "identity", "displayName"],
        ) && isRustSemanticIdentity(value.identity) &&
          isNonEmptyString(value.displayName);
      case "inference-variable":
        return hasExactKeys(value, ["kind", "identity"], ["kind", "identity"]) &&
          isRustSemanticIdentity(value.identity);
      case "array":
        return hasExactKeys(value, ["kind", "element", "length"], ["kind", "element", "length"]) &&
          validateChild(value.element) && isRustConstExpr(value.length, active, depth + 1);
      case "sequence":
      case "slice":
        return hasExactKeys(value, ["kind", "element"], ["kind", "element"]) &&
          validateChild(value.element);
      case "tuple":
        return hasExactKeys(value, ["kind", "elements"], ["kind", "elements"]) &&
          isDenseDataArray(value.elements) && value.elements.length > 0 &&
          value.elements.every(validateChild);
      case "reference":
        return hasExactKeys(
          value,
          ["kind", "lifetime", "mutable", "target"],
          ["kind", "lifetime", "mutable", "target"],
        ) && isRustLifetime(value.lifetime) && typeof value.mutable === "boolean" &&
          validateChild(value.target);
      case "raw-pointer":
        return hasExactKeys(value, ["kind", "mutable", "target"], ["kind", "mutable", "target"]) &&
          typeof value.mutable === "boolean" && validateChild(value.target);
      case "path":
        return hasExactKeys(
          value,
          ["kind", "identity", "displayPath", "arguments"],
          ["kind", "identity", "displayPath", "arguments"],
        ) && isRustSemanticIdentity(value.identity) && isStringList(value.displayPath) &&
          isRustGenericArguments(value.arguments, active, depth + 1);
      case "function-pointer":
        return hasExactKeys(
          value,
          ["kind", "binder", "safety", "abi", "parameters", "variadic", "result"],
          ["kind", "safety", "abi", "parameters", "variadic", "result"],
        ) && (value.binder === undefined || isRustBinder(value.binder, active, depth + 1)) &&
          (value.safety === "safe" || value.safety === "unsafe") &&
          rustAbiNames.has(value.abi) && validateChildren(value.parameters) &&
          typeof value.variadic === "boolean" && (!value.variadic || value.abi !== "Rust") &&
          validateChild(value.result);
      case "closure":
        return hasExactKeys(
          value,
          ["kind", "binder", "callTrait", "parameters", "result", "captures"],
          ["kind", "callTrait", "parameters", "result", "captures"],
        ) && (value.binder === undefined || isRustBinder(value.binder, active, depth + 1)) &&
          (value.callTrait === "fn" || value.callTrait === "fn-mut" ||
          value.callTrait === "fn-once") && validateChildren(value.parameters) &&
          validateChild(value.result) && isRustCapturedGenerics(value.captures);
      case "trait-object":
        if (!hasExactKeys(
          value,
          ["kind", "principal", "autoTraits", "lifetime"],
          ["kind", "principal", "autoTraits", "lifetime"],
        ) || !isRustTraitRef(value.principal, active, depth + 1) ||
          !isDenseDataArray(value.autoTraits) || !isRustLifetime(value.lifetime)) {
          return false;
        }
        return hasUniqueAutoTraitIdentities(value.principal, value.autoTraits, active, depth + 1);
      case "opaque":
        return hasExactKeys(
          value,
          ["kind", "identity", "bounds", "captures"],
          ["kind", "identity", "bounds", "captures"],
        ) && isRustSemanticIdentity(value.identity) &&
          isDenseDataArray(value.bounds) && value.bounds.length > 0 && value.bounds.every((bound) =>
            isRustBound(bound, active, depth + 1)) &&
          isRustCapturedGenerics(value.captures);
      case "associated-type":
        return hasExactKeys(
          value,
          ["kind", "owner", "trait", "item", "displayName", "arguments"],
          ["kind", "owner", "trait", "item", "displayName", "arguments"],
        ) && validateChild(value.owner) && isRustTraitRef(value.trait, active, depth + 1) &&
          isRustSemanticIdentity(value.item) && isNonEmptyString(value.displayName) &&
          isRustGenericArguments(value.arguments, active, depth + 1);
      case "source-carrier":
        return hasExactKeys(
          value,
          ["kind", "identity", "payload"],
          ["kind", "identity", "payload"],
        ) && isRustSemanticIdentity(value.identity) && isClosedMetadata(value.payload);
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

const rustPrimitiveNames = new Set<unknown>([
  "bool", "char", "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64",
  "i128", "u128", "isize", "usize", "f16", "f32", "f64",
]);

const rustAbiNames = new Set<unknown>([
  "Rust", "C", "C-unwind", "system", "system-unwind", "cdecl", "stdcall",
  "fastcall", "vectorcall", "thiscall", "aapcs", "win64", "sysv64", "efiapi",
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

export function isRustSemanticIdentity(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "builtin":
      return hasExactKeys(value, ["kind", "namespace", "itemId"], ["kind", "namespace", "itemId"]) &&
        (value.namespace === "rust" || value.namespace === "tsonic-runtime") &&
        isNonEmptyString(value.itemId);
    case "provider":
      return hasExactKeys(
        value,
        ["kind", "providerId", "providerVersion", "compilationSnapshotId", "itemId"],
        ["kind", "providerId", "compilationSnapshotId", "itemId"],
      ) && isNonEmptyString(value.providerId) &&
        (value.providerVersion === undefined || isNonEmptyString(value.providerVersion)) &&
        isNonEmptyString(value.compilationSnapshotId) && isNonEmptyString(value.itemId);
    case "project":
      return hasExactKeys(
        value,
        ["kind", "packageId", "sourceFileId", "declarationId"],
        ["kind", "packageId", "sourceFileId", "declarationId"],
      ) && isNonEmptyString(value.packageId) && isNonEmptyString(value.sourceFileId) &&
        isNonEmptyString(value.declarationId);
    case "generated":
      return hasExactKeys(value, ["kind", "artifactId", "itemId"], ["kind", "artifactId", "itemId"]) &&
        isNonEmptyString(value.artifactId) && isNonEmptyString(value.itemId);
    default:
      return false;
  }
}

function isRustLifetime(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "static":
      return hasExactKeys(value, ["kind"], ["kind"]);
    case "parameter":
      return hasExactKeys(
        value,
        ["kind", "identity", "displayName"],
        ["kind", "identity", "displayName"],
      ) && isRustSemanticIdentity(value.identity) && isNonEmptyString(value.displayName);
    case "bound":
      return hasExactKeys(
        value,
        ["kind", "binderId", "parameterId", "displayName"],
        ["kind", "binderId", "parameterId", "displayName"],
      ) && isNonEmptyString(value.binderId) && isNonEmptyString(value.parameterId) &&
        isNonEmptyString(value.displayName);
    case "inferred-region":
      return hasExactKeys(value, ["kind", "regionId"], ["kind", "regionId"]) &&
        isNonEmptyString(value.regionId);
    default:
      return false;
  }
}

function isRustConstExpr(value: unknown, active: WeakSet<object>, depth: number): boolean {
  if (!isPlainRecord(value) || depth > 128 || active.has(value)) return false;
  active.add(value);
  try {
    switch (value.kind) {
      case "literal":
        return hasExactKeys(
          value,
          ["kind", "literalKind", "value"],
          ["kind", "literalKind", "value"],
        ) && (
          value.literalKind === "boolean" && typeof value.value === "boolean" ||
          value.literalKind === "integer" && typeof value.value === "bigint" ||
          value.literalKind === "character" && typeof value.value === "string" &&
            singleRustUnicodeScalar(value.value) !== undefined
        );
      case "parameter":
        return hasExactKeys(
          value,
          ["kind", "identity", "displayName"],
          ["kind", "identity", "displayName"],
        ) && isRustSemanticIdentity(value.identity) && isNonEmptyString(value.displayName);
      case "item":
        return hasExactKeys(
          value,
          ["kind", "identity", "displayPath"],
          ["kind", "identity", "displayPath"],
        ) && isRustSemanticIdentity(value.identity) && isStringList(value.displayPath);
      case "unary":
        return hasExactKeys(value, ["kind", "operator", "operand"], ["kind", "operator", "operand"]) &&
          (value.operator === "negate" || value.operator === "not") &&
          isRustConstExpr(value.operand, active, depth + 1);
      case "binary":
        return hasExactKeys(
          value,
          ["kind", "operator", "left", "right"],
          ["kind", "operator", "left", "right"],
        ) && rustConstBinaryOperators.has(value.operator) &&
          isRustConstExpr(value.left, active, depth + 1) &&
          isRustConstExpr(value.right, active, depth + 1);
      case "inferred":
        return hasExactKeys(value, ["kind"], ["kind"]);
      default:
        return false;
    }
  } finally {
    active.delete(value);
  }
}

const rustConstBinaryOperators = new Set<unknown>([
  "add", "subtract", "multiply", "divide", "remainder", "shift-left", "shift-right",
  "bit-and", "bit-or", "bit-xor",
]);

function isRustGenericArguments(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): boolean {
  return isDenseDataArray(value) && value.every((argument) => {
    if (!isPlainRecord(argument)) return false;
    if (!hasExactKeys(argument, ["kind", "value"], ["kind", "value"])) return false;
    if (argument.kind === "lifetime") return isRustLifetime(argument.value);
    if (argument.kind === "type") {
      return validateRustTargetTypeRef(argument.value, active, depth + 1);
    }
    return argument.kind === "const" && isRustConstExpr(argument.value, active, depth + 1);
  });
}

function isRustGenericArgument(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): value is import("../semantics/index.js").RustGenericArgument {
  return isPlainRecord(value) && hasExactKeys(value, ["kind", "value"], ["kind", "value"]) && (
    value.kind === "type" && validateRustTargetTypeRef(value.value, active, depth + 1) ||
    value.kind === "lifetime" && isRustLifetime(value.value) ||
    value.kind === "const" && isRustConstExpr(value.value, active, depth + 1)
  );
}

function isRustCapturedGenerics(value: unknown): boolean {
  if (!isDenseDataArray(value)) return false;
  const identities = new Set<string>();
  let previous: RustCapturedGeneric | undefined;
  for (const capture of value) {
    if (!isPlainRecord(capture)) return false;
    if (capture.kind === "lifetime") {
      if (!hasExactKeys(capture, ["kind", "value"], ["kind", "value"]) ||
        !isRustLifetime(capture.value)) return false;
    } else if (capture.kind === "type" || capture.kind === "const") {
      if (!hasExactKeys(
        capture,
        ["kind", "identity", "displayName"],
        ["kind", "identity", "displayName"],
      ) || !isRustSemanticIdentity(capture.identity) || !isNonEmptyString(capture.displayName)) {
        return false;
      }
    } else {
      return false;
    }
    const selected = capture as RustCapturedGeneric;
    if (previous !== undefined && compareRustCapturedGenerics(previous, selected) >= 0) return false;
    const identity = rustCapturedGenericSemanticKey(selected);
    if (identities.has(identity)) return false;
    identities.add(identity);
    previous = selected;
  }
  return true;
}

function hasUniqueAutoTraitIdentities(
  principal: RustTraitRef,
  autoTraits: readonly unknown[],
  active: WeakSet<object>,
  depth: number,
): boolean {
  const identities = new Set<string>([rustSemanticIdentityKey(principal.identity)]);
  for (const value of autoTraits) {
    if (!isRustTraitRef(value, active, depth) || value.arguments.length !== 0 ||
      value.associatedConstraints.length !== 0) return false;
    const identity = rustSemanticIdentityKey(value.identity);
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

function isRustTraitRef(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): value is RustTraitRef {
  if (!isPlainRecord(value) || depth > 128 || active.has(value)) return false;
  active.add(value);
  try {
    if (!hasExactKeys(
      value,
      ["identity", "displayPath", "arguments", "associatedConstraints"],
      ["identity", "displayPath", "arguments", "associatedConstraints"],
    ) || !isRustSemanticIdentity(value.identity) || !isStringList(value.displayPath) ||
      !isRustGenericArguments(value.arguments, active, depth + 1) ||
      !isDenseDataArray(value.associatedConstraints)) {
      return false;
    }

    const semanticProjections = new Set<string>();
    const renderedProjections = new Set<string>();
    for (const constraint of value.associatedConstraints) {
      if (!isPlainRecord(constraint) || !isRustSemanticIdentity(constraint.item) ||
        !isNonEmptyString(constraint.displayName) ||
        !isRustGenericArguments(constraint.arguments, active, depth + 1)) {
        return false;
      }
      if (constraint.kind === "equality") {
        if (!hasExactKeys(
          constraint,
          ["kind", "item", "displayName", "arguments", "type"],
          ["kind", "item", "displayName", "arguments", "type"],
        ) || !validateRustTargetTypeRef(constraint.type, active, depth + 1)) {
          return false;
        }
      } else if (constraint.kind === "bounds") {
        if (!hasExactKeys(
          constraint,
          ["kind", "item", "displayName", "arguments", "bounds"],
          ["kind", "item", "displayName", "arguments", "bounds"],
        ) || !isDenseDataArray(constraint.bounds) || constraint.bounds.length === 0 ||
          !constraint.bounds.every((bound) => isRustBound(bound, active, depth + 1))) {
          return false;
        }
      } else {
        return false;
      }

      const argumentKeys = (constraint.arguments as readonly RustGenericArgument[])
        .map(rustGenericArgumentSemanticKey);
      const semanticProjection = JSON.stringify([
        rustSemanticIdentityKey(constraint.item),
        ...argumentKeys,
      ]);
      const renderedProjection = JSON.stringify([constraint.displayName, ...argumentKeys]);
      if (semanticProjections.has(semanticProjection) || renderedProjections.has(renderedProjection)) {
        return false;
      }
      semanticProjections.add(semanticProjection);
      renderedProjections.add(renderedProjection);
    }
    return true;
  } finally {
    active.delete(value);
  }
}

function isRustBinder(value: unknown, _active: WeakSet<object>, _depth: number): boolean {
  if (!isPlainRecord(value) ||
    !hasExactKeys(value, ["id", "lifetimes"], ["id", "lifetimes"]) ||
    !isNonEmptyString(value.id) || !isDenseDataArray(value.lifetimes) ||
    value.lifetimes.length === 0) return false;
  const parameterIds = new Set<string>();
  for (const parameter of value.lifetimes) {
    if (!isPlainRecord(parameter) ||
      !hasExactKeys(parameter, ["kind", "identity", "bounds"], ["kind", "identity", "bounds"]) ||
      parameter.kind !== "lifetime" || !isPlainRecord(parameter.identity) ||
      parameter.identity.kind !== "bound" || parameter.identity.binderId !== value.id ||
      !isRustLifetime(parameter.identity) || !isDenseDataArray(parameter.bounds) ||
      !parameter.bounds.every(isRustLifetime) || parameterIds.has(parameter.identity.parameterId)) {
      return false;
    }
    parameterIds.add(parameter.identity.parameterId);
  }
  return true;
}

function isRustBound(value: unknown, active: WeakSet<object>, depth: number): boolean {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "trait":
      return hasExactKeys(value, ["kind", "binder", "trait", "polarity"], ["kind", "trait", "polarity"]) &&
        (value.binder === undefined || isRustBinder(value.binder, active, depth + 1)) &&
        isRustTraitRef(value.trait, active, depth + 1) &&
        (value.polarity === "required" || value.polarity === "maybe" || value.polarity === "negative");
    case "lifetime-outlives":
      return hasExactKeys(value, ["kind", "longer", "shorter"], ["kind", "longer", "shorter"]) &&
        isRustLifetime(value.longer) && isRustLifetime(value.shorter);
    case "type-outlives":
      return hasExactKeys(value, ["kind", "type", "lifetime"], ["kind", "type", "lifetime"]) &&
        validateRustTargetTypeRef(value.type, active, depth + 1) &&
        isRustLifetime(value.lifetime);
    case "associated-equality":
      return hasExactKeys(value, ["kind", "projection", "value"], ["kind", "projection", "value"]) &&
        validateRustTargetTypeRef(value.projection, active, depth + 1) &&
        isPlainRecord(value.projection) && value.projection.kind === "associated-type" &&
        validateRustTargetTypeRef(value.value, active, depth + 1);
    default:
      return false;
  }
}

function isStringList(value: unknown): boolean {
  return isDenseDataArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
