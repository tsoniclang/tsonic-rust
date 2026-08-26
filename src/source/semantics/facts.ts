import { defineExtensionFactKey } from "@tsonic/tsts";
import { rustSourceSemanticsExtensionId } from "./identity.js";
import type {
  RustSourceGenericParameterFact,
  RustSourceReferenceOperationFact,
  RustSourceTypeContractFact,
} from "./model.js";

export const rustSourceTypeContractFactKey =
  defineExtensionFactKey<RustSourceTypeContractFact>({
    extensionId: rustSourceSemanticsExtensionId,
    name: "sourceTypeContract",
    snapshot: (value) => Object.freeze({ ...value }),
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
      nodesEqual(left.outlives, right.outlives) &&
      nodesEqual(left.typeOutlives, right.typeOutlives) &&
      left.maybeSized === right.maybeSized,
  });

export const rustSourceReferenceOperationFactKey =
  defineExtensionFactKey<RustSourceReferenceOperationFact>({
    extensionId: rustSourceSemanticsExtensionId,
    name: "sourceReferenceOperation",
    snapshot: (value) => Object.freeze({ ...value }),
    equals: sourceReferenceOperationsEqual,
  });

function sourceTypeContractsEqual(
  left: RustSourceTypeContractFact,
  right: RustSourceTypeContractFact,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "lifetime-kind":
    case "static-lifetime":
    case "maybe-sized":
      return true;
    case "shared-reference":
    case "mutable-reference":
      return right.kind === left.kind &&
        left.targetTypeNode === right.targetTypeNode &&
        left.lifetimeTypeNode === right.lifetimeTypeNode;
    case "outlives":
    case "valid-for":
      return right.kind === left.kind &&
        left.lifetimeTypeNode === right.lifetimeTypeNode;
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
  }
}

function nodesEqual(left: readonly object[], right: readonly object[]): boolean {
  return left.length === right.length &&
    left.every((node, index) => node === right[index]);
}

function sourceReferenceOperationsEqual(
  left: RustSourceReferenceOperationFact,
  right: RustSourceReferenceOperationFact,
): boolean {
  if (left.kind !== right.kind || left.call !== right.call ||
    left.resultType !== right.resultType ||
    !providerIdentitiesEqual(left.selectedDeclaration, right.selectedDeclaration)) {
    return false;
  }
  switch (left.kind) {
    case "shared-reference":
    case "mutable-reference":
      return right.kind === left.kind &&
        left.valueExpression === right.valueExpression &&
        left.valueType === right.valueType &&
        left.lifetimeTypeNode === right.lifetimeTypeNode;
    case "load":
      return right.kind === "load" &&
        left.referenceExpression === right.referenceExpression &&
        left.referenceType === right.referenceType;
    case "store":
      return right.kind === "store" &&
        left.referenceExpression === right.referenceExpression &&
        left.referenceType === right.referenceType &&
        left.valueExpression === right.valueExpression &&
        left.valueType === right.valueType;
  }
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
