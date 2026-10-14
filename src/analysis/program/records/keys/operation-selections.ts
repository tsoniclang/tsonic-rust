import { rustBindingStorageEquals, rustComputedMemberEquals, rustClosureCaptureEquals, rustSourceCallableValueEquals } from "../../../../target-model/records/equality.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";

import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustOptionalChainFact } from "../../../../target-model/operations/model.js";
import type { RustPlanKey } from "../key.js";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "../../../../target-model/records/operations.js";
import type { RustPreparedOperationResultFact, RustBindingStorageFact, RustClosureCaptureFact, RustSourceCallableValueFact, RustComputedMemberFact } from "../../../../target-model/records/operation-selections.js";

export const rustCompoundWriteFactKey: RustPlanKey<Extract<RustTargetOperationFact, { kind: "runtime-set" }>> =
  defineRustPlanKey("compoundWrite", closedMetadataEquals);

export const rustComputedMemberFactKey: RustPlanKey<RustComputedMemberFact> = defineRustPlanKey("computedMember", rustComputedMemberEquals);

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
