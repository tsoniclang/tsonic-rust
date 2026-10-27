import { isRustBigIntCarrier, isRustJsStringCarrier, isRustStringCarrier, isRustUnitCarrier } from "../../../target-model/types/carriers/js.js";
import { rustMutableJsErrorTargetId, rustSourceErrorTargetId, rustWritableSourceErrorTargetId, isRustRetainedErrorCarrier } from "../../../target-model/types/carriers/source-error.js";
import { isRustAbsenceCarrier, isRustStringViewCarrier } from "../../../target-model/types/carriers/native.js";
import { rustJsArrayValueTargetId } from "../../../target-model/types/carriers/array-values.js";
import { isRustNumericCarrier } from "../../../target-model/types/carriers/primitives.js";

import { rustClassConstructorInstance } from "../../../target-model/types/carriers/class-constructors.js";
import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";

import { rustJsArrayTargetId, rustJsDateTargetId, rustJsMapTargetId, rustJsRegExpTargetId, rustJsSetTargetId, rustJsValueTargetId, rustAbsenceTargetId, rustProgramErrorTargetId, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue, rustTsValueTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustJsArrayEntriesTargetId } from "../../../target-model/types/carriers/array-entries.js";
import { rustJsArrayBufferTargetId, rustJsDataViewTargetId, rustJsFloat32ArrayTargetId, rustJsFloat64ArrayTargetId, rustJsInt16ArrayTargetId, rustJsInt32ArrayTargetId, rustJsInt8ArrayTargetId, rustJsIntlCollatorTargetId, rustJsIntlDateTimeFormatTargetId, rustJsIntlNumberFormatTargetId, rustJsPromiseTargetId, rustJsSymbolTargetId, rustJsUint16ArrayTargetId, rustJsUint32ArrayTargetId, rustJsUint8ArrayTargetId, rustJsUint8ClampedArrayTargetId, rustJsWeakMapTargetId, rustJsWeakSetTargetId } from "../../../target-model/types/carriers/source-types.js";

import { rustEmptyObjectTargetId, rustObjectIdentityTargetId, rustJsNumericTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";

import { rustCarrierSupportsClone } from "../../constraints/native-traits.js";
import type { RustTsValueAdmission } from "../../../target-model/records/types/js-value-admission.js";
export function isRustJsStrictEqualityCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "target-named" && rustJsStrictEqualityTargetIds.has(carrier.id);
}

export function rustCarrierCanEnterTsValue(carrier: TargetTypeRef | undefined, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): boolean {
  if (!rustCarrierSupportsClone(carrier, definitions) || carrier === undefined) {
    return false;
  }
  const references = rustTargetGenericReferences(carrier);
  return references.typeIdentities.length === 0 && references.lifetimeIdentities.length === 0 &&
    references.callScopedElisions.length === 0 && !references.hasUnnameableLifetime;
}

export function rustTsValueAdmission(carrier: TargetTypeRef, definitions: RustTypeDefinitions): RustTsValueAdmission | undefined {
  if (carrier.kind === "target-named" && (carrier.id === rustJsValueTargetId || carrier.id === rustTsValueTargetId) &&
    !isRustClosedValueCarrier(carrier)) return undefined;
  if (!rustCarrierCanEnterTsValue(carrier, definitions) || rustOptionElementCarrier(carrier) !== undefined ||
    rustSourceUnionCarrierValue(carrier) !== undefined) return undefined;
  if (carrier.kind === "source-primitive" || isRustStringCarrier(carrier) || isRustBigIntCarrier(carrier) ||
    isRustUnitCarrier(carrier) || isRustAbsenceCarrier(carrier) ||
    carrier.kind === "target-named" && (carrier.id === rustEmptyObjectTargetId || carrier.id === rustObjectIdentityTargetId) ||
    rustStructuralObjectCarrierValue(carrier)?.representation === "reference") {
    return { kind: "call", path: "rt::TsValue::from" };
  }
  if (rustSourceTypeCarrierValue(carrier)?.shape === "object") return { kind: "project-object" };
  return { kind: "call", path: rustCarrierSupportsObjectIdentity(carrier)
    ? "rt::TsValue::from_identity" : "rt::TsValue::from_closed" };
}

export function rustCarrierHasNativeValueView(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" || isRustStringCarrier(carrier) || isRustBigIntCarrier(carrier) ||
    isRustUnitCarrier(carrier) || isRustAbsenceCarrier(carrier) ||
    carrier?.kind === "target-named" && carrier.id === rustTsValueTargetId;
}

export function rustCarrierSupportsJsEquality(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" || isRustStringCarrier(carrier) ||
    isRustJsStringCarrier(carrier) ||
    isRustBigIntCarrier(carrier) || isRustAbsenceCarrier(carrier) ||
    isRustJsStrictEqualityCarrier(carrier);
}

export function rustCarrierSupportsObjectIdentity(carrier: TargetTypeRef | undefined): boolean {
  if (rustClassConstructorInstance(carrier) !== undefined) return true;
  const structural = rustStructuralObjectCarrierValue(carrier);
  return structural !== undefined ? structural.representation !== "value"
    : carrier?.kind === "target-named" && rustObjectIdentityTargetIds.has(carrier.id);
}

const rustObjectIdentityTargetIds: ReadonlySet<string> = new Set([
  rustJsArrayValueTargetId,
  rustEmptyObjectTargetId,
  rustObjectIdentityTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsWeakMapTargetId,
  rustJsWeakSetTargetId,
  rustJsDateTargetId,
  rustJsArrayEntriesTargetId,
  rustJsPromiseTargetId,
  rustJsArrayBufferTargetId,
  rustJsDataViewTargetId,
  rustJsInt8ArrayTargetId,
  rustJsUint8ArrayTargetId,
  rustJsUint8ClampedArrayTargetId,
  rustJsInt16ArrayTargetId,
  rustJsUint16ArrayTargetId,
  rustJsInt32ArrayTargetId,
  rustJsUint32ArrayTargetId,
  rustJsFloat32ArrayTargetId,
  rustJsFloat64ArrayTargetId,
  rustJsIntlDateTimeFormatTargetId,
  rustJsIntlNumberFormatTargetId,
  rustJsIntlCollatorTargetId,
  rustJsRegExpTargetId,
]);

const rustJsStrictEqualityTargetIds: ReadonlySet<string> = new Set([
  rustJsArrayValueTargetId,
  rustEmptyObjectTargetId,
  rustObjectIdentityTargetId,
  rustAbsenceTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsPromiseTargetId,
  rustJsSymbolTargetId,
  rustJsWeakMapTargetId,
  rustJsWeakSetTargetId,
  rustJsArrayEntriesTargetId,
  rustJsArrayBufferTargetId,
  rustJsDataViewTargetId,
  rustJsInt8ArrayTargetId,
  rustJsUint8ArrayTargetId,
  rustJsUint8ClampedArrayTargetId,
  rustJsInt16ArrayTargetId,
  rustJsUint16ArrayTargetId,
  rustJsInt32ArrayTargetId,
  rustJsUint32ArrayTargetId,
  rustJsFloat32ArrayTargetId,
  rustJsFloat64ArrayTargetId,
  rustJsIntlDateTimeFormatTargetId,
  rustJsIntlNumberFormatTargetId,
  rustJsIntlCollatorTargetId,
  rustJsRegExpTargetId,
]);

export function isRustSourceStringConvertibleCarrier(carrier: TargetTypeRef | undefined): boolean {
  const optional = rustOptionElementCarrier(carrier);
  if (optional !== undefined) return isRustSourceStringConvertibleCarrier(optional);
  return isRustStringViewCarrier(carrier) || isRustUnitCarrier(carrier) ||
    isRustAbsenceCarrier(carrier) ||
    isRustBigIntCarrier(carrier) ||
    (carrier?.kind === "target-named" && (carrier.id === rustProgramErrorTargetId || carrier.id === rustSourceErrorTargetId ||
      carrier.id === rustWritableSourceErrorTargetId || carrier.id === rustMutableJsErrorTargetId)) || isRustRetainedErrorCarrier(carrier) ||
    (carrier?.kind === "source-primitive" && carrier.name !== "char");
}

export function isRustSourceNumberConvertibleCarrier(carrier: TargetTypeRef | undefined): boolean {
  const optional = rustOptionElementCarrier(carrier);
  if (optional !== undefined) return isRustSourceNumberConvertibleCarrier(optional);
  return carrier?.kind === "source-primitive" && carrier.name === "bool" ||
    isRustNumericCarrier(carrier) || isRustStringViewCarrier(carrier) || isRustBigIntCarrier(carrier) ||
    isRustUnitCarrier(carrier) || isRustAbsenceCarrier(carrier) ||
    carrier?.kind === "target-named" && (carrier.id === rustJsValueTargetId || carrier.id === rustJsNumericTargetId);
}
