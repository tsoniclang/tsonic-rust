import type { RustValueConversion } from "../../target-model/operations/model.js";

import { rustUnionLeaves } from "../../target-model/types/union-relations.js";

import { isRustJsArrayCarrier, isRustAbsenceCarrier, rustCarrierSupportsClone, rustJsArrayLikeElementTargetType, rustJsValueTargetType, rustOptionElementCarrier, rustStringTargetType, rustStructuralObjectCarrierValue, rustCallableProtocol, rustTargetGenericReferences } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

import { selectRustSourceValueConversion, selectRustUnionFoldConversion, selectRustStructuralObjectConversionFields } from "./selection.js";
const stringCarrier = rustStringTargetType();
const jsValueCarrier = rustJsValueTargetType();

export function selectRustProjectedValueConversion(
  source: TargetTypeRef,
  projection: "json" | "properties",
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  properties?: (source: TargetTypeRef) => RustValueConversion | undefined,
): RustValueConversion | undefined {
  if (projection !== "json" && projection !== "properties") return undefined;
  return selectProjectedValueConversion(source, projection, projection === "json", [], definitions, properties);
}

function selectProjectedValueConversion(
  source: TargetTypeRef,
  projection: "json" | "properties",
  applySelectedToJson: boolean,
  ancestors: readonly TargetTypeRef[],
  definitions: RustTypeDefinitions,
  properties?: (source: TargetTypeRef) => RustValueConversion | undefined,
): RustValueConversion | undefined {
  if (ancestors.some((ancestor) => rustTargetTypeRefEquals(ancestor, source))) {
    return undefined;
  }
  const nextAncestors = [...ancestors, source];
  const structural = rustStructuralObjectCarrierValue(source);
  const toJsonMethods = structural?.fields.flatMap((field, storageIndex) =>
    field.method === true && field.sourceName === "toJSON"
      ? [{ field, storageIndex }]
      : []) ?? [];
  if (applySelectedToJson && toJsonMethods.length === 1) {
    const toJsonMethod = toJsonMethods[0]!;
    const callable = toJsonMethod.field.presence === "required"
      ? rustCallableProtocol(toJsonMethod.field.type)
      : undefined;
    const passesPropertyKey = callable?.parameters.length === 1 &&
      rustTargetTypeRefEquals(callable.parameters[0], stringCarrier);
    const validParameters = callable?.parameters.length === 0 || passesPropertyKey;
    const resultConversion = callable === undefined ||
        rustTargetTypeRefEquals(callable.result, source)
      ? undefined
      : selectProjectedValueConversion(callable.result, projection, false, nextAncestors, definitions);
    if (callable === undefined || !validParameters || resultConversion === undefined ||
        resultConversion.kind === "option-map" ||
        resultConversion.kind === "option-some" ||
        rustTargetGenericReferences(source).lifetimeIdentities.length !== 0) {
      return undefined;
    }
    return Object.freeze({
      kind: "js-value-from-structural-to-json" as const,
      source,
      storageIndex: toJsonMethod.storageIndex,
      resultCarrier: callable.result,
      passesPropertyKey,
      resultConversion,
    });
  }
  if (applySelectedToJson && toJsonMethods.length > 1) {
    return undefined;
  }
  const optionElement = rustOptionElementCarrier(source);
  if (optionElement !== undefined) {
    const elementConversion = selectProjectedValueConversion(
      optionElement,
      projection,
      applySelectedToJson,
      nextAncestors,
      definitions,
      properties,
    );
    return elementConversion === undefined ||
        elementConversion.kind === "option-map" ||
        elementConversion.kind === "option-some"
      ? undefined
      : Object.freeze({
          kind: "closed-value-from-option" as const,
          source,
          element: optionElement,
          elementConversion,
        });
  }
  const arrayElement = isRustJsArrayCarrier(source)
    ? rustJsArrayLikeElementTargetType(source)
    : undefined;
  if (arrayElement !== undefined && rustCarrierSupportsClone(arrayElement, definitions)) {
    const elementConversion = selectProjectedValueConversion(
      arrayElement,
      projection,
      projection === "json",
      nextAncestors,
      definitions,
      properties,
    );
    return elementConversion === undefined ||
        elementConversion.kind === "option-map" ||
        elementConversion.kind === "option-some"
      ? undefined
      : Object.freeze({
          kind: "js-value-from-array" as const,
          source,
          element: arrayElement,
          elementConversion,
        });
  }
  const unionLeaves = rustUnionLeaves(source, definitions);
  if (unionLeaves !== undefined) {
    return selectRustUnionFoldConversion(source, jsValueCarrier, unionLeaves, unionLeaves.map(leaf =>
      selectProjectedValueConversion(leaf.carrier, projection, applySelectedToJson, nextAncestors, definitions, properties)));
  }
  if (projection === "properties") {
    return isRustAbsenceCarrier(source)
      ? selectRustSourceValueConversion(source, jsValueCarrier, definitions)
      : properties?.(source);
  }
  if (structural !== undefined) {
    const fields = selectRustStructuralObjectConversionFields(
      structural,
      new Map(structural.fields.map(field => {
        const carrier = field.presence === "optional" ? rustOptionElementCarrier(field.type) : field.type;
        return [field.type, carrier === undefined ? undefined : selectProjectedValueConversion(carrier, projection, projection === "json", nextAncestors, definitions)] as const;
      })),
    );
    return fields === undefined ? undefined : Object.freeze({
      kind: "js-value-from-structural-object" as const,
      source,
      fields,
    });
  }
  return selectRustSourceValueConversion(source, jsValueCarrier, definitions);
}
