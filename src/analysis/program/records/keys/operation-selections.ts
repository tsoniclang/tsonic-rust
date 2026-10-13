import { rustBindingStorageEquals, rustComputedMemberEquals, rustClosureCaptureEquals, rustSourceCallableValueEquals } from "../../../../target-model/records/equality.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";

import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustOptionalChainFact } from "../../../../target-model/operations/model.js";
import type { RustPlanKey } from "../key.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "../../../../target-model/records/operations.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetOperationFactEquals } from "../../../operations/contracts/equality.js";
import type { RustPreparedOperationResultFact, RustBindingStorageFact, RustClosureCaptureFact, RustSourceCallableValueFact, RustModuleBindingFact, RustComputedMemberFact } from "../../../../target-model/records/operation-selections.js";


export const rustTargetOperationFactKey: RustPlanKey<RustTargetOperationFact> =
  defineRustPlanKey("targetOperation", rustTargetOperationFactEquals);

export const rustCompoundWriteFactKey: RustPlanKey<Extract<RustTargetOperationFact, { kind: "runtime-set" }>> =
  defineRustPlanKey("compoundWrite", closedMetadataEquals);

export const rustComputedMemberFactKey: RustPlanKey<RustComputedMemberFact> = defineRustPlanKey("computedMember", rustComputedMemberEquals);

export const rustReceiverIndependentMethodFactKey: RustPlanKey<{ readonly carrier: TargetTypeRef }> =
  defineRustPlanKey("receiverIndependentMethod", (left, right) => rustTargetTypeRefEquals(left.carrier, right.carrier));

export const rustPreparedOperationResultFactKey: RustPlanKey<RustPreparedOperationResultFact> =
  defineRustPlanKey("preparedOperationResult", (left, right) =>
    left.operationId === right.operationId &&
    left.operationKind === right.operationKind &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier));

export const rustOptionalChainFactKey: RustPlanKey<RustOptionalChainFact> =
  defineRustPlanKey("optionalChain", (left, right) => {
    const { expression: leftExpression, guard: leftGuard, ...leftMetadata } = left;
    const { expression: rightExpression, guard: rightGuard, ...rightMetadata } = right;
    return leftExpression === rightExpression && leftGuard === rightGuard &&
      closedMetadataEquals(leftMetadata, rightMetadata);
  });

export const rustTypedLocationPlanKey: RustPlanKey<RustTypedLocationPlan> =
  defineRustPlanKey("typedLocationPlan", rustTypedLocationPlanEquals);

export const rustBindingStorageFactKey: RustPlanKey<RustBindingStorageFact> = defineRustPlanKey(
  "bindingStorage",
  rustBindingStorageEquals,
);

export const rustClosureCaptureFactKey: RustPlanKey<RustClosureCaptureFact> = defineRustPlanKey(
  "closureCaptures",
  rustClosureCaptureEquals,
);

export const rustSourceCallableValueFactKey: RustPlanKey<RustSourceCallableValueFact> = defineRustPlanKey(
  "sourceCallableValue", rustSourceCallableValueEquals,
);

export const rustDirectCallableReferenceFactKey: RustPlanKey<RustSourceCallableValueFact> = defineRustPlanKey(
  "directCallableReference", rustSourceCallableValueEquals,
);

export const rustModuleBindingFactKey: RustPlanKey<RustModuleBindingFact> = defineRustPlanKey(
  "moduleBinding",
  (left, right) => left.declarationKind === right.declarationKind &&
    left.storage === right.storage &&
    (left.storage === "native-callable"
      ? right.storage === "native-callable" &&
        left.callableDeclaration === right.callableDeclaration &&
        left.name === right.name &&
        nativeCallableValuesEqual(left.value, right.value)
      : right.storage !== "native-callable" &&
        (left.storage !== "module-cell" || right.storage === "module-cell" &&
          left.initialization === right.initialization) &&
        rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier)),
);

function nativeCallableValuesEqual(
  left: Extract<RustModuleBindingFact, { readonly storage: "native-callable" }>["value"],
  right: Extract<RustModuleBindingFact, { readonly storage: "native-callable" }>["value"],
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
      rustTargetTypeRefEquals(left.carrier, right.carrier) &&
      left.name === right.name &&
      left.parameterCarriers.length === right.parameterCarriers.length &&
      left.parameterCarriers.every((carrier, index) =>
        rustTargetTypeRefEquals(carrier, right.parameterCarriers[index])) &&
      rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier);
}

function rustTypedLocationPlanEquals(
  left: RustTypedLocationPlan,
  right: RustTypedLocationPlan,
): boolean {
  if (left.operation !== right.operation || left.call !== right.call ||
    !rustTargetTypeRefEquals(left.pointeeCarrier, right.pointeeCarrier) ||
    !rustTargetTypeRefEquals(left.locationCarrier, right.locationCarrier)) {
    return false;
  }
  switch (left.operation) {
    case "address-of":
      return right.operation === "address-of" &&
        left.storageExpression === right.storageExpression &&
        left.storageDeclaration === right.storageDeclaration &&
        left.rootExpression === right.rootExpression &&
        left.rootDeclaration === right.rootDeclaration &&
        left.locationIdentity === right.locationIdentity;
    case "allocate":
      return right.operation === "allocate" &&
        left.initialExpression === right.initialExpression &&
        left.locationIdentity === right.locationIdentity;
    case "load":
      return right.operation === "load" &&
        left.pointerExpression === right.pointerExpression;
    case "store":
      return right.operation === "store" &&
        left.pointerExpression === right.pointerExpression &&
        left.valueExpression === right.valueExpression;
    case "equal-pointer":
      return right.operation === "equal-pointer" &&
        left.leftExpression === right.leftExpression &&
        left.rightExpression === right.rightExpression;
    case "hash-pointer":
      return right.operation === left.operation && left.pointerExpression === right.pointerExpression;
    case "bind-pointer":
      return right.operation === left.operation &&
        left.identityExpression === right.identityExpression &&
        left.readExpression === right.readExpression &&
        left.writeExpression === right.writeExpression;
    case "project-pointer":
      return right.operation === left.operation &&
        left.pointerExpression === right.pointerExpression &&
        left.optional === right.optional &&
        left.fromSourceExpression === right.fromSourceExpression &&
        left.toSourceExpression === right.toSourceExpression &&
        rustTargetTypeRefEquals(left.sourcePointeeCarrier, right.sourcePointeeCarrier);
    case "view-pointer":
      return right.operation === left.operation &&
        left.pointerExpression === right.pointerExpression &&
        left.optional === right.optional &&
        left.readExpression === right.readExpression &&
        left.writeExpression === right.writeExpression &&
        rustTargetTypeRefEquals(left.sourcePointeeCarrier, right.sourcePointeeCarrier);
  }
}
