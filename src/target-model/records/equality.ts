import { closedMetadataEquals, hasExactObjectKeys, isDenseDataArray, isMetadataRecord } from "../metadata/closed-data.js";
import { isRustCapturedFieldStorage } from "../types/field-storage.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import type { RustClosureCaptureFact, RustSourceCallableValueFact } from "./operation-selections.js";

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
        ...(Object.prototype.hasOwnProperty.call(capture, "mutable") ? ["mutable"] : [])]) &&
      capture.declaration !== undefined && capture.reference !== undefined && capture.carrier !== undefined &&
      (capture.storage === "value" || capture.storage === "location" || capture.storage === "cell" || capture.storage === "borrow-cell") &&
      (capture.mutable === undefined || capture.mutable === true));
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
