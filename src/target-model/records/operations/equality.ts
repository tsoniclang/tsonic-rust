import type { RustBindingStorageFact, RustComputedMemberFact, RustClosureCaptureFact, RustSourceCallableValueFact } from "./operation-selections.js";
import type { RustCapturedFieldStorageFact } from "../callables/receiver-captures.js";
import type { RustCallScopedLifetimeReconciliationFact, RustFlowReadProjectionFact, RustSourceBindingFact } from "../objects/value-projections.js";
import type { RustProjectDowncastFact } from "../../types/project-projections.js";
import type { RustSourceCallableReturnFact } from "../program/source-declarations.js";
import { closedMetadataEquals, hasExactObjectKeys, isDenseDataArray, isMetadataRecord } from "../../metadata/closed-data.js";
import { isRustCapturedFieldStorage } from "../../types/field-storage.js";
import { rustTargetTypeRefEquals } from "../../types/equality.js";
import { rustLifetimesEqual } from "../../lifetimes/index.js";
import type {
  RustAsyncFunctionFact, RustGeneratorFact, RustJsPromiseLowering, RustSuspendedCallableStorage,
  RustSuspendedOwnedReceiver,
} from "../callables/callables-and-resources.js";

export function rustSourceCallableReturnFactEquals(left: RustSourceCallableReturnFact, right: RustSourceCallableReturnFact): boolean {
  return rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier) &&
    left.borrowedParameter === right.borrowedParameter && left.implementationCompletion === right.implementationCompletion &&
    left.undefinedReturn === right.undefinedReturn && left.fallthroughUndefined === right.fallthroughUndefined &&
    left.canFallThrough === right.canFallThrough;
}

export function rustSourceBindingFactEquals(left: RustSourceBindingFact, right: RustSourceBindingFact): boolean {
  return left.scope === right.scope && left.sourceName === right.sourceName && left.sourceDeclaration === right.sourceDeclaration &&
    (left.scope !== "module" || right.scope === "module" && left.fileName === right.fileName);
}

export function rustAsyncFunctionFactEquals(left: RustAsyncFunctionFact, right: RustAsyncFunctionFact): boolean {
  return left.kind === right.kind && rustTargetTypeRefEquals(left.futureCarrier, right.futureCarrier) &&
    rustTargetTypeRefEquals(left.outputCarrier, right.outputCarrier) &&
    (left.kind === "native-future" || right.kind === "native-future" ||
      rustJsPromiseLoweringEquals(left.lowering, right.lowering));
}

function rustJsPromiseLoweringEquals(left: RustJsPromiseLowering, right: RustJsPromiseLowering): boolean {
  if (left.kind === "settled" || right.kind === "settled") {
    return left.kind === "settled" && right.kind === "settled" &&
      left.settledAwaits.length === right.settledAwaits.length &&
      left.settledAwaits.every((selected, index) => selected.expression === right.settledAwaits[index]!.expression &&
        selected.callee === right.settledAwaits[index]!.callee);
  }
  return rustSuspendedCallableStorageEquals(left.storage, right.storage) &&
    left.capturedCarriers.length === right.capturedCarriers.length &&
    left.capturedCarriers.every((carrier, index) => rustTargetTypeRefEquals(carrier, right.capturedCarriers[index])) &&
    left.capturedParameters.length === right.capturedParameters.length &&
    left.capturedParameters.every((parameter, index) => parameter === right.capturedParameters[index]) &&
    rustSuspendedOwnedReceiverEquals(left.ownedReceiver, right.ownedReceiver);
}

export function rustGeneratorFactEquals(left: RustGeneratorFact, right: RustGeneratorFact): boolean {
  return left.kind === right.kind && rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) && rustTargetTypeRefEquals(left.returnType, right.returnType) &&
    rustTargetTypeRefEquals(left.nextType, right.nextType) &&
    left.capturedParameters.length === right.capturedParameters.length &&
    left.capturedParameters.every((parameter, index) => parameter === right.capturedParameters[index]) &&
    rustSuspendedCallableStorageEquals(left.storage, right.storage) &&
    rustSuspendedOwnedReceiverEquals(left.ownedReceiver, right.ownedReceiver);
}

export function rustCallScopedLifetimeReconciliationEquals(
  left: RustCallScopedLifetimeReconciliationFact,
  right: RustCallScopedLifetimeReconciliationFact,
): boolean {
  return rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.selectedCarrier, right.selectedCarrier);
}

export function rustProjectDowncastEquals(left: RustProjectDowncastFact, right: RustProjectDowncastFact): boolean {
  return rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier) &&
    rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier) &&
    closedMetadataEquals(left.projection, right.projection);
}

export function rustSuspendedOwnedReceiverEquals(
  left: RustSuspendedOwnedReceiver | undefined,
  right: RustSuspendedOwnedReceiver | undefined,
): boolean {
  return left === undefined ? right === undefined : right !== undefined &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.occurrences.length === right.occurrences.length &&
    left.occurrences.every((node, index) => node === right.occurrences[index]);
}

export function rustSuspendedCallableStorageEquals(
  left: RustSuspendedCallableStorage,
  right: RustSuspendedCallableStorage,
): boolean {
  return left.kind === right.kind &&
    (left.kind !== "lifetime" ||
      right.kind === "lifetime" && rustLifetimesEqual(left.lifetime, right.lifetime));
}

export function rustClosureCaptureEquals(left: RustClosureCaptureFact, right: RustClosureCaptureFact): boolean {
  return closureCaptureShapeMatches(left) && closureCaptureShapeMatches(right) &&
    left.invocationOwner === right.invocationOwner &&
    left.receivers.length === right.receivers.length &&
    left.receivers.every((capture, index) => {
      const other = right.receivers[index];
      return other !== undefined && capture.owner === other.owner && capture.reference === other.reference &&
        rustTargetTypeRefEquals(capture.carrier, other.carrier) && capture.references.length === other.references.length &&
        capture.references.every((reference, offset) => reference === other.references[offset]);
    }) &&
    left.receiverFields.length === right.receiverFields.length &&
    left.receiverFields.every((capture, index) => {
      const other = right.receiverFields[index];
      return other !== undefined && capture.declaration === other.declaration &&
        capture.reference === other.reference && capture.receiver === other.receiver &&
        closedMetadataEquals(capture.storage, other.storage) && rustTargetTypeRefEquals(capture.carrier, other.carrier) &&
        capture.references.length === other.references.length &&
        capture.references.every((reference, offset) => reference === other.references[offset]);
    }) &&
    left.recursiveDeclaration === right.recursiveDeclaration &&
    (left.recursiveField === undefined ? right.recursiveField === undefined : right.recursiveField !== undefined &&
      left.recursiveField.declaration === right.recursiveField.declaration &&
      left.recursiveField.receiver === right.recursiveField.receiver &&
      left.recursiveField.reference === right.recursiveField.reference &&
      rustTargetTypeRefEquals(left.recursiveField.carrier, right.recursiveField.carrier) &&
      left.recursiveField.references.length === right.recursiveField.references.length &&
      left.recursiveField.references.every((reference, index) => reference === right.recursiveField!.references[index])) &&
    left.captures.length === right.captures.length &&
    left.captures.every((capture, index) => {
      const other = right.captures[index];
      return other !== undefined &&
        capture.declaration === other.declaration &&
        capture.reference === other.reference &&
        capture.storage === other.storage &&
        capture.mutable === other.mutable &&
        Object.prototype.hasOwnProperty.call(capture, "fieldName") === Object.prototype.hasOwnProperty.call(other, "fieldName") &&
        capture.fieldName === other.fieldName &&
        rustTargetTypeRefEquals(capture.carrier, other.carrier);
    });
}

function closureCaptureShapeMatches(value: RustClosureCaptureFact): boolean {
  if (!isMetadataRecord(value) || !hasExactObjectKeys(value, ["receivers", "receiverFields", "captures",
    ...["invocationOwner", "recursiveDeclaration", "recursiveField"].filter(key => Object.prototype.hasOwnProperty.call(value, key))]) ||
    value.invocationOwner !== undefined && value.invocationOwner !== "shared-state" ||
    !isDenseDataArray(value.receivers) || !isDenseDataArray(value.receiverFields) || !isDenseDataArray(value.captures)) return false;
  if (value.recursiveField !== undefined && (!isMetadataRecord(value.recursiveField) ||
    !hasExactObjectKeys(value.recursiveField, ["declaration", "reference", "receiver", "references", "carrier"]) ||
    value.recursiveField.declaration === undefined || value.recursiveField.declaration !== value.recursiveDeclaration || value.recursiveField.receiver === undefined ||
    value.recursiveField.carrier === undefined || !isDenseDataArray(value.recursiveField.references) ||
    value.recursiveField.references.length === 0 || value.recursiveField.reference !== value.recursiveField.references[0] ||
    value.receiverFields.some(capture => !isMetadataRecord(capture) || capture.declaration === value.recursiveField!.declaration))) return false;
  return value.receivers.every(capture => isMetadataRecord(capture) &&
    hasExactObjectKeys(capture, ["owner", "reference", "references", "carrier"]) &&
    capture.owner !== undefined && capture.carrier !== undefined && isDenseDataArray(capture.references) &&
    capture.references.length > 0 && capture.reference === capture.references[0]) &&
    value.receiverFields.every(capture => isMetadataRecord(capture) &&
    hasExactObjectKeys(capture, ["declaration", "reference", "receiver", "references", "carrier", "storage"]) &&
    capture.declaration !== undefined && capture.receiver !== undefined && capture.carrier !== undefined &&
    isRustCapturedFieldStorage(capture.storage) && isDenseDataArray(capture.references) &&
    capture.references.length > 0 && capture.reference === capture.references[0]) &&
    value.captures.every(capture => isMetadataRecord(capture) &&
      hasExactObjectKeys(capture, ["declaration", "reference", "carrier", "storage",
        ...(Object.prototype.hasOwnProperty.call(capture, "mutable") ? ["mutable"] : []),
        ...(Object.prototype.hasOwnProperty.call(capture, "fieldName") ? ["fieldName"] : [])]) &&
      capture.declaration !== undefined && capture.reference !== undefined && capture.carrier !== undefined &&
      (capture.storage === "value" || capture.storage === "location" || capture.storage === "cell" || capture.storage === "borrow-cell") &&
      (capture.mutable === undefined || capture.mutable === true) &&
      (!Object.prototype.hasOwnProperty.call(capture, "fieldName") || typeof capture.fieldName === "string"));
}

export function rustSourceCallableValueEquals(left: RustSourceCallableValueFact, right: RustSourceCallableValueFact): boolean {
  return left.form === right.form &&
    left.sourceDeclaration === right.sourceDeclaration &&
    left.fileName === right.fileName &&
    left.name === right.name &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.parameterCarriers.length === right.parameterCarriers.length &&
    left.parameterCarriers.every((carrier, index) =>
      rustTargetTypeRefEquals(carrier, right.parameterCarriers[index])) &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier);
}

export function rustBindingStorageEquals(left: RustBindingStorageFact, right: RustBindingStorageFact): boolean {
  return bindingStorageShapeMatches(left) && bindingStorageShapeMatches(right) &&
    left.storage === right.storage && left.initialization === right.initialization &&
    left.iterationScope === right.iterationScope &&
    rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier);
}
function bindingStorageShapeMatches(value: RustBindingStorageFact): boolean {
  return isMetadataRecord(value) && hasExactObjectKeys(value, ["storage", "valueCarrier",
    ...["initialization", "iterationScope"].filter(key => Object.prototype.hasOwnProperty.call(value, key))]) &&
    (value.storage === "location" || value.storage === "cell" || value.storage === "borrow-cell") &&
    value.valueCarrier !== undefined && (value.initialization === undefined ||
      value.initialization === "deferred" && value.storage === "location") &&
    (value.iterationScope === undefined || value.iterationScope !== null && value.storage === "location");
}
export function rustComputedMemberEquals(left: RustComputedMemberFact, right: RustComputedMemberFact): boolean {
  return left.receiver === right.receiver && left.key === right.key &&
  left.evaluateReceiver === right.evaluateReceiver &&
  left.evaluateKey === right.evaluateKey && left.accessMode === right.accessMode;
}
export function rustCapturedFieldStorageEquals(left: RustCapturedFieldStorageFact, right: RustCapturedFieldStorageFact): boolean {
  return hasExactObjectKeys(left, ["storage", "valueCarrier"]) &&
    hasExactObjectKeys(right, ["storage", "valueCarrier"]) && isRustCapturedFieldStorage(left.storage) &&
    isRustCapturedFieldStorage(right.storage) && left.valueCarrier !== undefined && right.valueCarrier !== undefined &&
    closedMetadataEquals(left.storage, right.storage) &&
    rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier);
}
export function rustFlowReadProjectionEquals(left: RustFlowReadProjectionFact, right: RustFlowReadProjectionFact): boolean {
  return flowReadProjectionShapeMatches(left) && flowReadProjectionShapeMatches(right) && left.kind === right.kind &&
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.selectedCarrier, right.selectedCarrier) &&
    (left.kind !== "union-map" || right.kind === "union-map" &&
      rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier) && closedMetadataEquals(left.arms, right.arms)) &&
    (left.kind !== "source-union" && left.kind !== "runtime-union" ||
      (right.kind === left.kind && left.variant === right.variant &&
        rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier) &&
        Object.prototype.hasOwnProperty.call(left, "project") === Object.prototype.hasOwnProperty.call(right, "project") &&
        closedMetadataEquals(left.project, right.project))) &&
    (left.kind !== "project-downcast" ||
      (right.kind === "project-downcast" &&
        rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier) &&
        closedMetadataEquals(left.projection, right.projection))) &&
    (left.kind !== "program-error-variant" ||
      (right.kind === "program-error-variant" && left.variant === right.variant));
}

function flowReadProjectionShapeMatches(value: RustFlowReadProjectionFact): boolean {
  const common = ["kind", "sourceCarrier", "selectedCarrier"];
  switch (value.kind) {
    case "union-map":
      return hasExactObjectKeys(value, [...common, "dispatchCarrier", "arms"]);
    case "source-union":
    case "runtime-union":
      return hasExactObjectKeys(value, [...common, "dispatchCarrier", "variant",
        ...(Object.prototype.hasOwnProperty.call(value, "project") ? ["project"] : [])]);
    case "project-downcast":
      return hasExactObjectKeys(value, [...common, "dispatchCarrier", "projection"]);
    case "program-error-variant":
      return hasExactObjectKeys(value, [...common, "variant"]);
    case "builtin-error":
    case "option-value":
    case "option-reference":
    case "closed-native":
      return hasExactObjectKeys(value, common);
  }
}
