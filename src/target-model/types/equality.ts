import {
  closedMetadataEquals,
  isClosedMetadata,
  isDenseDataArray,
} from "../metadata/closed-data.js";
import type {
  RustSelectedTargetOperation,
  RustSelectedTargetSignature,
  RustTargetConstArgument,
  RustTargetGenericArgument,
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

export function rustTargetTypeRefEqualsWithinLifetimeBinders(
  left: RustTargetTypeRef | undefined,
  right: RustTargetTypeRef | undefined,
  leftBinder: RustLifetimeBinder,
  rightBinder: RustLifetimeBinder,
): boolean {
  if (left === undefined || right === undefined ||
    !isRustTargetTypeRef(left) || !isRustTargetTypeRef(right)) {
    return false;
  }
  const context = matchLifetimeBinders(
    leftBinder,
    rightBinder,
    emptyLifetimeEqualityContext,
  );
  return context !== undefined && rustTargetTypeRefEqualsValidated(left, right, context);
}

export function isRustTargetTypeRef(value: unknown): value is RustTargetTypeRef {
  try {
    return validateRustTargetTypeRef(value, new WeakSet<object>(), 0);
  } catch {
    return false;
  }
}

export function isRustTargetGenericArgument(
  value: unknown,
): value is RustTargetGenericArgument {
  try {
    return validateGenericArguments([value], isRustTargetTypeRef);
  } catch {
    return false;
  }
}

export function rustTargetGenericArgumentEquals(
  left: RustTargetGenericArgument | undefined,
  right: RustTargetGenericArgument | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return genericArgumentListsEqual(
    [left],
    [right],
    emptyLifetimeEqualityContext,
  );
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
    closedMetadataEquals(left.targetGenericArguments, right.targetGenericArguments) &&
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
  lifetimeContext: LifetimeEqualityContext = emptyLifetimeEqualityContext,
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
        genericArgumentListsEqual(left.genericArguments, right.genericArguments, lifetimeContext);
    case "type-parameter":
      return right.kind === left.kind && left.name === right.name;
    case "opaque":
      return right.kind === left.kind && left.id === right.id;
    case "array":
      return right.kind === left.kind && left.rank === right.rank &&
        rustTargetTypeRefEqualsValidated(left.element, right.element, lifetimeContext);
    case "slice":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.element, right.element, lifetimeContext);
    case "tuple":
      return right.kind === left.kind &&
        targetTypeRefListsEqual(left.elements, right.elements, lifetimeContext);
    case "reference":
      return right.kind === left.kind && left.mutable === right.mutable &&
        lifetimesEqual(left.lifetime, right.lifetime, lifetimeContext) &&
        rustTargetTypeRefEqualsValidated(left.referent, right.referent, lifetimeContext);
    case "pointer":
      return right.kind === left.kind && left.mutability === right.mutability &&
        rustTargetTypeRefEqualsValidated(left.pointee, right.pointee, lifetimeContext);
    case "function-pointer": {
      if (right.kind !== left.kind || !stringListsEqual(left.abi, right.abi) ||
        left.isUnsafe !== right.isUnsafe) {
        return false;
      }
      const nested = matchLifetimeBinders(
        left.lifetimeBinder,
        right.lifetimeBinder,
        lifetimeContext,
      );
      return nested !== undefined &&
        targetTypeRefListsEqual(left.args, right.args, nested) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result, nested);
    }
    case "trait-ref": {
      if (right.kind !== left.kind || left.id !== right.id || left.path !== right.path) {
        return false;
      }
      const nested = matchLifetimeBinders(
        left.lifetimeBinder,
        right.lifetimeBinder,
        lifetimeContext,
      );
      return nested !== undefined &&
        genericArgumentListsEqual(left.genericArguments, right.genericArguments, nested) &&
        associatedConstraintListsEqual(
          left.associatedConstraints,
          right.associatedConstraints,
          nested,
        );
    }
    case "closure": {
      if (right.kind !== left.kind) return false;
      const nested = matchLifetimeBinders(
        left.lifetimeBinder,
        right.lifetimeBinder,
        lifetimeContext,
      );
      return nested !== undefined &&
        targetTypeRefListsEqual(left.args, right.args, nested) &&
        rustTargetTypeRefEqualsValidated(left.result, right.result, nested);
    }
    case "trait-object":
      return right.kind === left.kind &&
        rustTargetTypeRefEqualsValidated(left.principal, right.principal, lifetimeContext) &&
        targetTypeRefListsEqual(left.autoTraits, right.autoTraits, lifetimeContext) &&
        lifetimesEqual(left.lifetime, right.lifetime, lifetimeContext);
    case "impl-trait":
      return right.kind === left.kind && left.id === right.id &&
        targetTypeRefListsEqual(left.bounds, right.bounds, lifetimeContext) &&
        lifetimeListsEqual(left.outlives, right.outlives, lifetimeContext) &&
        genericArgumentListsEqual(left.captures, right.captures, lifetimeContext);
    case "associated-type":
      return right.kind === left.kind && left.name === right.name &&
        genericArgumentListsEqual(left.genericArguments, right.genericArguments, lifetimeContext) &&
        optionalTargetTypesEqual(left.trait, right.trait, lifetimeContext) &&
        rustTargetTypeRefEqualsValidated(left.owner, right.owner, lifetimeContext);
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
          ["kind", "id", "genericArguments"],
          ["kind", "id"],
        ) &&
          typeof value.id === "string" && value.id.length > 0 &&
          (value.genericArguments === undefined ||
            validateGenericArguments(value.genericArguments, validateChild));
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
      case "trait-ref":
        return hasExactKeys(
          value,
          ["kind", "id", "path", "genericArguments", "associatedConstraints", "lifetimeBinder"],
          ["kind", "id", "path", "genericArguments", "associatedConstraints"],
        ) && nonEmptyString(value.id) && nonEmptyString(value.path) &&
          validateGenericArguments(value.genericArguments, validateChild) &&
          validateAssociatedConstraints(value.associatedConstraints, validateChild) &&
          (value.lifetimeBinder === undefined || validateLifetimeBinder(value.lifetimeBinder));
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
        ) && isPlainRecord(value.principal) && value.principal.kind === "trait-ref" &&
          validateChild(value.principal) && isDenseDataArray(value.autoTraits) &&
          value.autoTraits.every((trait) =>
            isPlainRecord(trait) && trait.kind === "trait-ref" && validateChild(trait)) &&
          (value.lifetime === undefined || validateLifetime(value.lifetime));
      case "impl-trait":
        return hasExactKeys(
          value,
          ["kind", "id", "bounds", "outlives", "captures"],
          ["kind", "id", "bounds", "outlives", "captures"],
        ) && typeof value.id === "string" && value.id.length > 0 &&
          isDenseDataArray(value.bounds) && value.bounds.every((bound) =>
            isPlainRecord(bound) && bound.kind === "trait-ref" && validateChild(bound)) &&
          validateLifetimeList(value.outlives) &&
          validateGenericArguments(value.captures, validateChild);
      case "associated-type":
        return hasExactKeys(
          value,
          ["kind", "owner", "trait", "name", "genericArguments"],
          ["kind", "owner", "name"],
        ) && validateChild(value.owner) &&
          (value.trait === undefined ||
            isPlainRecord(value.trait) && value.trait.kind === "trait-ref" &&
              validateChild(value.trait)) &&
          typeof value.name === "string" && value.name.length > 0 &&
          (value.genericArguments === undefined ||
            validateGenericArguments(value.genericArguments, validateChild));
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

function validateGenericArguments(
  value: unknown,
  validateType: (value: unknown) => value is RustTargetTypeRef,
): value is readonly RustTargetGenericArgument[] {
  return isDenseDataArray(value) && value.every((argument) => {
    if (!isPlainRecord(argument)) return false;
    if (argument.kind === "lifetime") {
      return hasExactKeys(argument, ["kind", "lifetime"], ["kind", "lifetime"]) &&
        validateLifetime(argument.lifetime);
    }
    if (argument.kind === "type") {
      return hasExactKeys(argument, ["kind", "type"], ["kind", "type"]) &&
        validateType(argument.type);
    }
    return argument.kind === "const" &&
      hasExactKeys(argument, ["kind", "value"], ["kind", "value"]) &&
      validateConstArgument(argument.value);
  });
}

function validateAssociatedConstraints(
  value: unknown,
  validateType: (value: unknown) => value is RustTargetTypeRef,
): value is readonly import("./model.js").RustTargetAssociatedConstraint[] {
  if (!isDenseDataArray(value)) return false;
  const identities = new Set<string>();
  for (const constraint of value) {
    if (!isPlainRecord(constraint) || !nonEmptyString(constraint.identity) ||
      !nonEmptyString(constraint.name) || identities.has(constraint.identity) ||
      !validateGenericArguments(constraint.genericArguments, validateType)) {
      return false;
    }
    identities.add(constraint.identity);
    if (constraint.kind === "equality") {
      if (!hasExactKeys(
        constraint,
        ["kind", "identity", "name", "genericArguments", "type"],
        ["kind", "identity", "name", "genericArguments", "type"],
      ) || !validateType(constraint.type)) return false;
      continue;
    }
    if (constraint.kind !== "bounds" || !hasExactKeys(
      constraint,
      ["kind", "identity", "name", "genericArguments", "traits", "outlives"],
      ["kind", "identity", "name", "genericArguments", "traits", "outlives"],
    ) || !isDenseDataArray(constraint.traits) ||
      !constraint.traits.every((trait) =>
        isPlainRecord(trait) && trait.kind === "trait-ref" && validateType(trait)) ||
      !validateLifetimeList(constraint.outlives)) {
      return false;
    }
  }
  return true;
}

function validateConstArgument(value: unknown): value is RustTargetConstArgument {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "infer":
      return hasExactKeys(value, ["kind"], ["kind"]);
    case "boolean":
      return hasExactKeys(value, ["kind", "value"], ["kind", "value"]) &&
        typeof value.value === "boolean";
    case "integer":
      return hasExactKeys(value, ["kind", "value"], ["kind", "value"]) &&
        typeof value.value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value.value);
    case "char":
      return hasExactKeys(value, ["kind", "value"], ["kind", "value"]) &&
        typeof value.value === "string" && [...value.value].length === 1;
    case "parameter":
      return hasExactKeys(
        value,
        ["kind", "identity", "name"],
        ["kind", "identity", "name"],
      ) && nonEmptyString(value.identity) && nonEmptyString(value.name);
    default:
      return false;
  }
}

function validateLifetime(value: unknown): value is RustLifetimeRef {
  if (!isPlainRecord(value)) return false;
  switch (value.kind) {
    case "static":
    case "placeholder":
      return hasExactKeys(value, ["kind"], ["kind"]);
    case "call-scoped-elision":
      return hasExactKeys(
        value,
        ["kind", "callIdentity", "parameterIdentity"],
        ["kind", "callIdentity", "parameterIdentity"],
      ) && nonEmptyString(value.callIdentity) && nonEmptyString(value.parameterIdentity);
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
  if (!isPlainRecord(value) ||
    !hasExactKeys(value, ["identity", "parameters"], ["identity", "parameters"]) ||
    !nonEmptyString(value.identity) || !isDenseDataArray(value.parameters)) {
    return false;
  }
  const identities = new Set<string>();
  for (const parameter of value.parameters) {
    if (!isPlainRecord(parameter) ||
      !hasExactKeys(parameter, ["lifetime", "outlives"], ["lifetime", "outlives"]) ||
      !validateLifetime(parameter.lifetime) || parameter.lifetime.kind !== "bound" ||
      parameter.lifetime.binderIdentity !== value.identity ||
      !validateLifetimeList(parameter.outlives) ||
      identities.has(parameter.lifetime.identity)) {
      return false;
    }
    identities.add(parameter.lifetime.identity);
  }
  return true;
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
  lifetimeContext: LifetimeEqualityContext = emptyLifetimeEqualityContext,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined || left.length !== right.length ||
    !isDenseDataArray(left) || !isDenseDataArray(right)) {
    return false;
  }
  return left.every((entry, index) =>
    rustTargetTypeRefEqualsValidated(entry, right[index]!, lifetimeContext));
}

function optionalTargetTypesEqual(
  left: RustTargetTypeRef | undefined,
  right: RustTargetTypeRef | undefined,
  context: LifetimeEqualityContext,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : rustTargetTypeRefEqualsValidated(left, right, context);
}

function genericArgumentListsEqual(
  left: readonly RustTargetGenericArgument[] | undefined,
  right: readonly RustTargetGenericArgument[] | undefined,
  context: LifetimeEqualityContext,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.length !== right.length ||
    !isDenseDataArray(left) || !isDenseDataArray(right)) {
    return false;
  }
  return left.every((argument, index) => {
    const other = right[index];
    if (other === undefined || argument.kind !== other.kind) return false;
    switch (argument.kind) {
      case "lifetime":
        return other.kind === "lifetime" &&
          lifetimesEqual(argument.lifetime, other.lifetime, context);
      case "type":
        return other.kind === "type" &&
          rustTargetTypeRefEqualsValidated(argument.type, other.type, context);
      case "const":
        return other.kind === "const" && constArgumentsEqual(argument.value, other.value);
    }
  });
}

function associatedConstraintListsEqual(
  left: readonly import("./model.js").RustTargetAssociatedConstraint[],
  right: readonly import("./model.js").RustTargetAssociatedConstraint[],
  context: LifetimeEqualityContext,
): boolean {
  return left.length === right.length && left.every((constraint, index) => {
    const other = right[index];
    if (other === undefined || constraint.kind !== other.kind ||
      constraint.identity !== other.identity || constraint.name !== other.name ||
      !genericArgumentListsEqual(
        constraint.genericArguments,
        other.genericArguments,
        context,
      )) return false;
    return constraint.kind === "equality"
      ? other.kind === "equality" &&
          rustTargetTypeRefEqualsValidated(constraint.type, other.type, context)
      : other.kind === "bounds" &&
          targetTypeRefListsEqual(constraint.traits, other.traits, context) &&
          lifetimeListsEqual(constraint.outlives, other.outlives, context);
  });
}

function constArgumentsEqual(
  left: RustTargetConstArgument,
  right: RustTargetConstArgument,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "infer":
      return true;
    case "boolean":
    case "integer":
    case "char":
      return right.kind === left.kind && left.value === right.value;
    case "parameter":
      return right.kind === "parameter" && left.identity === right.identity;
  }
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
  context: LifetimeEqualityContext = emptyLifetimeEqualityContext,
): boolean {
  if (left === right) return true;
  return left !== undefined && right !== undefined &&
    left.length === right.length &&
    left.every((entry, index) => lifetimesEqual(entry, right[index], context));
}

interface LifetimeEqualityContext {
  readonly leftToRight: ReadonlyMap<string, string>;
  readonly rightToLeft: ReadonlyMap<string, string>;
}

const emptyLifetimeEqualityContext: LifetimeEqualityContext = Object.freeze({
  leftToRight: new Map(),
  rightToLeft: new Map(),
});

function lifetimesEqual(
  left: RustLifetimeRef | undefined,
  right: RustLifetimeRef | undefined,
  context: LifetimeEqualityContext,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.kind !== "bound" || right.kind !== "bound") {
    return rustLifetimesEqual(left, right);
  }
  const leftKey = `${left.binderIdentity}\0${left.identity}`;
  const rightKey = `${right.binderIdentity}\0${right.identity}`;
  const selectedRight = context.leftToRight.get(leftKey);
  const selectedLeft = context.rightToLeft.get(rightKey);
  return selectedRight === undefined && selectedLeft === undefined
    ? rustLifetimesEqual(left, right)
    : selectedRight === rightKey && selectedLeft === leftKey;
}

function matchLifetimeBinders(
  left: RustLifetimeBinder | undefined,
  right: RustLifetimeBinder | undefined,
  parent: LifetimeEqualityContext,
): LifetimeEqualityContext | undefined {
  if (left === undefined || right === undefined) {
    return left === right ? parent : undefined;
  }
  if (left.parameters.length !== right.parameters.length) return undefined;
  const leftToRight = new Map(parent.leftToRight);
  const rightToLeft = new Map(parent.rightToLeft);
  for (let index = 0; index < left.parameters.length; index += 1) {
    const leftLifetime = left.parameters[index]!.lifetime;
    const rightLifetime = right.parameters[index]!.lifetime;
    const leftKey = `${leftLifetime.binderIdentity}\0${leftLifetime.identity}`;
    const rightKey = `${rightLifetime.binderIdentity}\0${rightLifetime.identity}`;
    if (leftToRight.has(leftKey) || rightToLeft.has(rightKey)) return undefined;
    leftToRight.set(leftKey, rightKey);
    rightToLeft.set(rightKey, leftKey);
  }
  const nested = Object.freeze({ leftToRight, rightToLeft });
  return left.parameters.every((parameter, index) =>
    lifetimeListsEqual(
      parameter.outlives,
      right.parameters[index]!.outlives,
      nested,
    ))
    ? nested
    : undefined;
}
