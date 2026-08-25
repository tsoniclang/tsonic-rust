import { defineExtensionFactKey } from "@tsonic/tsts";
import { rustSourceSemanticsExtensionId } from "./identity.js";
import type {
  RustSourceDeclarationFact,
  RustSourceGenericParameterFact,
  RustSourceOwnershipOperationFact,
  RustSourcePointerOperationFact,
  RustSourceTypeContractFact,
} from "./model.js";

export const rustSourceTypeContractFactKey =
  defineExtensionFactKey<RustSourceTypeContractFact>({
    extensionId: rustSourceSemanticsExtensionId,
    name: "sourceTypeContract",
    snapshot: snapshotTypeContract,
    equals: sourceTypeContractsEqual,
  });

export const rustSourceGenericParameterFactKey =
  defineExtensionFactKey<RustSourceGenericParameterFact>({
    extensionId: rustSourceSemanticsExtensionId,
    name: "sourceGenericParameter",
    snapshot: (value) => Object.freeze({
      ...value,
      bounds: Object.freeze([...value.bounds]),
      outlives: Object.freeze([...value.outlives]),
      typeOutlives: Object.freeze([...value.typeOutlives]),
    }),
    equals: (left, right) =>
      left.parameter === right.parameter &&
      left.owner === right.owner &&
      left.kind === right.kind &&
      left.constraint === right.constraint &&
      left.defaultType === right.defaultType &&
      nodesEqual(left.bounds, right.bounds) &&
      left.constValueType === right.constValueType &&
      nodesEqual(left.outlives, right.outlives) &&
      nodesEqual(left.typeOutlives, right.typeOutlives) &&
      left.maybeSized === right.maybeSized,
  });

export const rustSourceOwnershipOperationFactKey =
  defineExtensionFactKey<RustSourceOwnershipOperationFact>({
    extensionId: rustSourceSemanticsExtensionId,
    name: "sourceOwnershipOperation",
    snapshot: (value) => Object.freeze({ ...value }),
    equals: (left, right) =>
      left.kind === right.kind &&
      left.call === right.call &&
      left.valueExpression === right.valueExpression &&
      left.valueType === right.valueType &&
      left.replacementExpression === right.replacementExpression &&
      left.replacementType === right.replacementType &&
      left.resultType === right.resultType &&
      providerIdentitiesEqual(left.selectedDeclaration, right.selectedDeclaration),
  });

export const rustSourcePointerOperationFactKey =
  defineExtensionFactKey<RustSourcePointerOperationFact>({
    extensionId: rustSourceSemanticsExtensionId,
    name: "sourcePointerOperation",
    snapshot: (value) => Object.freeze({ ...value }),
    equals: (left, right) => providerIdentitiesEqual(
      left.selectedDeclaration,
      right.selectedDeclaration,
    ) &&
      pointerOperationSubjectsEqual(left, right),
  });

export const rustSourceDeclarationFactKey =
  defineExtensionFactKey<RustSourceDeclarationFact>({
    extensionId: rustSourceSemanticsExtensionId,
    name: "sourceDeclarationApplication",
    snapshot: (value) => Object.freeze({
      ...value,
      ...(value.kind === "application"
        ? { application: Object.freeze({ ...value.application }) }
        : {}),
    }) as RustSourceDeclarationFact,
    equals: sourceDeclarationFactsEqual,
  });

function snapshotTypeContract(
  value: RustSourceTypeContractFact,
): RustSourceTypeContractFact {
  return Object.freeze({ ...value });
}

function sourceTypeContractsEqual(
  left: RustSourceTypeContractFact,
  right: RustSourceTypeContractFact,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "lifetime-kind":
    case "static-lifetime":
    case "maybe-sized":
    case "rust-char":
      return true;
    case "owned":
      return right.kind === left.kind && left.targetTypeNode === right.targetTypeNode;
    case "shared-reference":
    case "mutable-reference":
      return right.kind === left.kind &&
        left.targetTypeNode === right.targetTypeNode &&
        left.lifetimeTypeNode === right.lifetimeTypeNode;
    case "outlives":
    case "valid-for":
      return right.kind === left.kind && left.lifetimeTypeNode === right.lifetimeTypeNode;
    case "const-parameter":
      return right.kind === left.kind && left.valueTypeNode === right.valueTypeNode;
    case "trait-object":
      return right.kind === left.kind &&
        left.traitTypeNode === right.traitTypeNode &&
        left.lifetimeTypeNode === right.lifetimeTypeNode;
    case "capture-set":
      return right.kind === left.kind && left.tupleTypeNode === right.tupleTypeNode;
    case "opaque-type":
      return right.kind === left.kind &&
        left.boundTypeNode === right.boundTypeNode &&
        left.captureTypeNode === right.captureTypeNode;
    case "function-pointer":
      return right.kind === left.kind &&
        left.parameterTypesNode === right.parameterTypesNode &&
        left.resultTypeNode === right.resultTypeNode &&
        left.abiTypeNode === right.abiTypeNode &&
        left.safetyTypeNode === right.safetyTypeNode &&
        left.variadicTypeNode === right.variadicTypeNode;
  }
}

function nodesEqual(
  left: readonly object[],
  right: readonly object[],
): boolean {
  return left.length === right.length && left.every((node, index) => node === right[index]);
}

function providerIdentitiesEqual(
  left: import("@tsonic/tsts").ProviderDeclarationIdentity,
  right: import("@tsonic/tsts").ProviderDeclarationIdentity,
): boolean {
  return left.providerId === right.providerId &&
    left.providerVersion === right.providerVersion &&
    left.providerModuleId === right.providerModuleId &&
    left.moduleSpecifier === right.moduleSpecifier &&
    left.artifactFileName === right.artifactFileName &&
    left.exportName === right.exportName &&
    left.exportId === right.exportId &&
    left.memberName === right.memberName &&
    providerMemberKeysEqual(left.memberKey, right.memberKey) &&
    left.memberId === right.memberId &&
    left.memberStatic === right.memberStatic &&
    left.signatureId === right.signatureId;
}

function providerMemberKeysEqual(
  left: import("@tsonic/tsts").ProviderDeclarationIdentity["memberKey"],
  right: import("@tsonic/tsts").ProviderDeclarationIdentity["memberKey"],
): boolean {
  return left === right ||
    (left !== undefined && right !== undefined &&
      left.kind === right.kind && left.name === right.name);
}

function pointerOperationSubjectsEqual(
  left: RustSourcePointerOperationFact,
  right: RustSourcePointerOperationFact,
): boolean {
  if (left.kind !== right.kind || left.call !== right.call || left.resultType !== right.resultType) {
    return false;
  }
  switch (left.kind) {
    case "expose-address":
      return right.kind === left.kind &&
        left.pointerExpression === right.pointerExpression &&
        left.pointerType === right.pointerType &&
        left.mutable === right.mutable;
    case "restore-exposed-address":
      return right.kind === left.kind &&
        left.addressExpression === right.addressExpression &&
        left.addressType === right.addressType &&
        left.pointeeType === right.pointeeType &&
        left.explicitPointeeTypeNode === right.explicitPointeeTypeNode &&
        left.mutable === right.mutable;
    case "read-volatile":
      return right.kind === left.kind &&
        left.pointerExpression === right.pointerExpression &&
        left.pointerType === right.pointerType &&
        left.pointeeType === right.pointeeType &&
        left.explicitPointeeTypeNode === right.explicitPointeeTypeNode;
    case "write-volatile":
      return right.kind === left.kind &&
        left.pointerExpression === right.pointerExpression &&
        left.pointerType === right.pointerType &&
        left.valueExpression === right.valueExpression &&
        left.valueType === right.valueType &&
        left.pointeeType === right.pointeeType &&
        left.explicitPointeeTypeNode === right.explicitPointeeTypeNode;
  }
}

function sourceDeclarationFactsEqual(
  left: RustSourceDeclarationFact,
  right: RustSourceDeclarationFact,
): boolean {
  if (left.kind !== right.kind ||
    left.call !== right.call ||
    left.applicationTarget !== right.applicationTarget ||
    !providerIdentitiesEqual(left.selectedDeclaration, right.selectedDeclaration)) {
    return false;
  }
  if (left.kind === "builder-state" || right.kind === "builder-state") {
    return left.kind === right.kind;
  }
  return left.predecessor === right.predecessor &&
    declarationApplicationsEqual(left.application, right.application);
}

function declarationApplicationsEqual(
  left: Extract<RustSourceDeclarationFact, { readonly kind: "application" }>["application"],
  right: Extract<RustSourceDeclarationFact, { readonly kind: "application" }>["application"],
): boolean {
  if (left.operation !== right.operation) return false;
  switch (left.operation) {
    case "extern":
      return right.operation === left.operation && left.abiExpression === right.abiExpression;
    case "repr-packed":
    case "repr-align":
      return right.operation === left.operation &&
        left.alignmentExpression === right.alignmentExpression;
    case "unsafe-impl":
    case "negative-impl":
      return right.operation === left.operation && left.traitTypeNode === right.traitTypeNode;
    case "variadic":
    case "repr-c":
    case "repr-transparent":
    case "union":
    case "mutable-static":
    case "thread-local":
    case "unsafe-trait":
    case "drop":
      return true;
  }
}
