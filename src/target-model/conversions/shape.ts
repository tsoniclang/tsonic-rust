import { isRustTargetTypeRef } from "../types/equality.js";
import { hasExactObjectKeys as hasExactKeys, isClosedMetadata, isMetadataRecord as isRecord } from "../metadata/closed-data.js";
import { isRustUnionArmMappings, isRustUnionPath } from "../types/union-relations.js";
import type { RustValueConversion } from "../operations/model.js";

export function isRustValueConversion(value: unknown): value is RustValueConversion {
  return isClosedMetadata(value) && isRecord(value) &&
    (isNonOptionValueConversion(value) ||
      value.kind === "option-some" &&
      hasExactKeys(value, ["kind", "source", "element", "elementConversion"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.element) &&
      (value.elementConversion === null || isNonOptionValueConversion(value.elementConversion)) ||
      value.kind === "option-map" && hasExactKeys(value, ["kind", "elementConversion"]) &&
      isNonOptionValueConversion(value.elementConversion));
}

function isNonOptionValueConversion(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (value.kind === "semantic-conversion" &&
      hasExactKeys(value, ["kind", "id"]) && typeof value.id === "string") ||
    (value.kind === "numeric-promotion" &&
      hasExactKeys(value, ["kind", "source", "target"]) &&
      typeof value.source === "string" && typeof value.target === "string") ||
    (value.kind === "integer-refinement" && hasExactKeys(value, ["kind", "source", "target", "proof"]) &&
      value.proof === "nonnegative" && typeof value.source === "string" && typeof value.target === "string") ||
    (value.kind === "raw-pointer-mut-to-const" &&
      hasExactKeys(value, ["kind", "pointee"]) && isRustTargetTypeRef(value.pointee)) ||
    (value.kind === "copy-from-reference" &&
      hasExactKeys(value, ["kind", "target"]) && isRustTargetTypeRef(value.target)) ||
    (value.kind === "source-union-variant" &&
      hasExactKeys(value, ["kind", "source", "target", "variantName", "payloadCarrier", "payloadConversion"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      isRustTargetTypeRef(value.payloadCarrier) &&
      (value.payloadConversion === null || isNonOptionValueConversion(value.payloadConversion)) &&
      typeof value.variantName === "string" && value.variantName.length > 0) ||
    (value.kind === "bottom-coercion" &&
      hasExactKeys(value, ["kind", "source", "target"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target)) ||
    (value.kind === "js-argument-vector-callback" &&
      hasExactKeys(value, [
        "kind", "lane", "source", "target", "projections", "sourceFallible",
      ]) &&
      (value.lane === "native" || value.lane === "exact") &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      Array.isArray(value.projections) &&
      value.projections.every((projection) =>
        projection === "native-string" || projection === "exact-string" ||
        projection === "value" || projection === "rest-values") &&
      typeof value.sourceFallible === "boolean") ||
    isValueProjectionConversion(value);
}

function isValueProjectionConversion(value: Record<string, unknown>): boolean {
  if (value.kind === "source-optional") {
    return hasExactKeys(value, ["kind", "element"]) && isRustTargetTypeRef(value.element);
  }
  if (value.kind === "union-project") {
    return hasExactKeys(value, ["kind", "source", "target"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target);
  }
  if (value.kind === "union-map") {
    return hasExactKeys(value, ["kind", "source", "target", "arms", "coverage"]) &&
      (value.coverage === "source" || value.coverage === "target") &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) && isRustUnionArmMappings(value.arms);
  }
  if (value.kind === "exact-integer" || value.kind === "native-representation") {
    return hasExactKeys(value, ["kind", "source", "target"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target);
  }
  if (value.kind === "native-upcast") {
    return hasExactKeys(value, ["kind", "source", "target", "path"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      typeof value.path === "string";
  }
  if (value.kind === "rest-sequence") {
    return hasExactKeys(value, ["kind", "source", "elementTarget", "elementConversions"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.elementTarget) &&
      Array.isArray(value.elementConversions) && value.elementConversions.every(conversion =>
        conversion === null || isNonOptionValueConversion(conversion));
  }
  if (value.kind === "js-value-from-closed-carrier" ||
    value.kind === "ts-value-from-closed-carrier") {
    return hasExactKeys(value, ["kind", "source"]) &&
      isRustTargetTypeRef(value.source);
  }
  if (value.kind === "closed-value-from-option" || value.kind === "js-value-from-array") {
    return hasExactKeys(value, [
      "kind", "source", "element", "elementConversion",
    ]) && isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.element) &&
      isNonOptionValueConversion(value.elementConversion);
  }
  if (value.kind === "js-array-backing") {
    return hasExactKeys(value, ["kind", "source", "element"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.element);
  }
  if (value.kind === "union-fold") {
    return hasExactKeys(value, ["kind", "source", "target", "arms"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) && Array.isArray(value.arms) &&
      value.arms.length > 0 && value.arms.every((arm) =>
        isRecord(arm) && hasExactKeys(arm, [
          "path", "carrier", "conversion",
        ]) && isRustUnionPath(arm.path) && isRustTargetTypeRef(arm.carrier) &&
        isNonOptionValueConversion(arm.conversion));
  }
  if (value.kind === "js-value-from-structural-to-json") {
    return hasExactKeys(value, [
      "kind", "source", "storageIndex", "resultCarrier", "passesPropertyKey",
      "resultConversion",
    ]) && isRustTargetTypeRef(value.source) &&
      Number.isSafeInteger(value.storageIndex) && (value.storageIndex as number) >= 0 &&
      isRustTargetTypeRef(value.resultCarrier) &&
      typeof value.passesPropertyKey === "boolean" &&
      isNonOptionValueConversion(value.resultConversion);
  }
  if (value.kind !== "js-value-from-structural-object") {
    return false;
  }
  return hasExactKeys(value, ["kind", "source", "fields"]) &&
    isRustTargetTypeRef(value.source) && Array.isArray(value.fields) &&
    value.fields.every((field) => isRecord(field) && hasExactKeys(field, [
      "sourceName", "storageIndex", "sourceCarrier", "presence", "conversion",
    ]) && typeof field.sourceName === "string" && field.sourceName.length > 0 &&
      Number.isSafeInteger(field.storageIndex) && (field.storageIndex as number) >= 0 &&
      isRustTargetTypeRef(field.sourceCarrier) &&
      (field.presence === "required" || field.presence === "optional") &&
      isNonOptionValueConversion(field.conversion));
}
