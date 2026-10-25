import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustValueConversion } from "../../target-model/conversions/shape.js";
import { rustNativeRepresentationMatches } from "./native-representation.js";
import { rustCallableInputMatches } from "./callable-input.js";
import { rustUnionPayloadAdmission } from "./union-injection.js";

import { rustProgramErrorConversionMatches } from "./program-error.js";
import { rustJsRecordValueAdmission, rustJsSharedObjectValueAdmission } from "./closed-record.js";
import { rustClosedValueRetainsError } from "../../target-model/types/carriers/closed-values.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import { isRustAbsenceCarrier, isRustNeverCarrier, isRustNumericCarrier, rustCallableProtocol, rustClosureProtocol, rustJsArrayTargetType, rustJsStringTargetType, rustNeverTargetType, rustOptionTargetType, rustSourceOptionalTargetType, rustJsValueTargetType, rustJsErrorTargetType, rustEmptyObjectTargetType, rustOptionElementCarrier, rustPrimitiveTypeName, rustSourcePrimitiveTargetType, rustStringTargetType, rustStructuralObjectCarrierValue, rustJsArrayLikeElementTargetType, isRustJsArrayCarrier, isRustJsArrayValueCarrier, isRustJsValueCarrier, rustTargetGenericReferences, rustJsClosedValueCarrierTraitPath, rustTsValueTargetType, rustProgramErrorTargetType } from "../../target-model/types/index.js";
import { rustCarrierCanEnterTsValue, rustTsValueAdmission } from "../operations/js-values/carrier-protocols.js";
import { rustCarrierSupportsClone, rustCarrierSupportsTrait } from "../constraints/native-traits.js";

import { rustNumericValueConversionIsSupported } from "./numeric-promotion.js";
import { rustExactIntegerConversionMatches } from "./exact-integer.js";
import { selectRustUnionMappingEmission, selectRustUnionProjectionEmission } from "./union-mappings.js";

import { rustUnsignedIntegerCounterpart } from "../../target-model/conversions/integer-refinement.js";

import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";
import { closedMetadataEquals, isClosedMetadata, isDenseDataArray, hasExactObjectKeys } from "../../target-model/metadata/closed-data.js";
import { rustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustUnionLeaves } from "../../target-model/types/union-relations.js";
import { selectRustUnionArmMapping } from "./union-relations.js";

const stringCarrier = rustStringTargetType();
const exactStringCarrier = rustJsStringTargetType();
const jsValueCarrier = rustJsValueTargetType();
const tsValueCarrier = rustTsValueTargetType();

import type { RustValueConversionContract, RustValueConversionEffect } from "../../target-model/conversions/contracts.js";
import { selectRustIntrinsicConversionContract } from "./intrinsic-contracts.js";
export function rustValueConversionContract(
  value: RustValueConversion,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueConversionContract | undefined {
  if (!isRustValueConversion(value)) return undefined;
  if (value.kind === "program-error") {
    return rustProgramErrorConversionMatches(value, value.source, value.target, definitions)
      ? { category: "exact", lowering: "program-error", sourceMode: "value", fallible: false,
          source: value.source, target: value.target, route: value.route } : undefined;
  }
  if (value.kind === "exact-integer") {
    const targetElement = rustOptionElementCarrier(value.target);
    return isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      rustExactIntegerConversionMatches(value.source, value.target, value)
      ? { category: "checked-range", lowering: "exact-integer", sourceMode: "value",
          source: value.source, target: value.target, targetElement: targetElement ?? value.target,
          optional: targetElement !== undefined, lift: targetElement !== undefined && rustOptionElementCarrier(value.source) === undefined,
          fallible: true, errorBoundary: "target-runtime" }
      : undefined;
  }
  if (value.kind === "native-representation") {
    return hasExactObjectKeys(value, ["kind", "source", "target"]) &&
      isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      !rustTargetTypeRefEquals(value.source, value.target) && rustNativeRepresentationMatches(value.source, value.target)
      ? { category: "exact", lowering: "identity", sourceMode: "value", source: value.source, target: value.target, fallible: false }
      : undefined;
  }
  if (value.kind === "callable-input") {
    return rustCallableInputMatches(value.source, value.target)
      ? { category: "exact", lowering: "identity", sourceMode: "ref", source: value.source,
          target: value.target, fallible: false }
      : undefined;
  }
  if (value.kind === "native-upcast") {
    const upcasts = rustNamedTypeCarrierValue(value.source)?.upcasts.filter((upcast) =>
      rustTargetTypeRefEquals(upcast.target, value.target)) ?? [];
    return upcasts.length !== 1 || upcasts[0]!.path !== value.path ? undefined : {
      category: "projection", lowering: "call", path: value.path,
      sourceMode: "ref", source: value.source, target: value.target, fallible: false,
    };
  }
  if (value.kind === "rest-sequence") {
    const sequence = rustRestSequenceElements(value.source);
    if (sequence === undefined || !isDenseDataArray(value.elementConversions) ||
      value.elementConversions.length !== sequence.elements.length) return undefined;
    const conversions = value.elementConversions.map(conversion => conversion === null ? null : rustValueConversionContract(conversion, definitions));
    if (!isRustTargetTypeRef(value.elementTarget) ||
      sequence.elements.some((element, index) => {
        const conversion = conversions[index];
        return conversion === null ? !rustTargetTypeRefEquals(element, value.elementTarget)
        : conversion === undefined || conversion.fallible ||
          (conversion.category !== "exact" && conversion.category !== "numeric-promotion" &&
            conversion.category !== "js-number") ||
          !rustTargetTypeRefEquals(conversion.source, element) ||
          !rustTargetTypeRefEquals(conversion.target, value.elementTarget);
      })) {
      return undefined;
    }
    return {
      category: "projection", lowering: "rest-sequence", collection: sequence.collection,
      sourceMode: "ref", source: value.source,
      target: { kind: "array", element: value.elementTarget }, fallible: false,
      elementConversions: conversions as readonly (RustValueConversionContract | null)[],
      cloneSources: sequence.elements,
    };
  }
  if (value.kind === "ts-value-from-closed-carrier") {
    if (rustTargetTypeRefEquals(value.source, rustProgramErrorTargetType())) {
      return { category: "projection", lowering: "program-error-closed-value",
        sourceMode: "value", source: value.source, target: tsValueCarrier, fallible: false };
    }
    if (rustClosedValueRetainsError(value.source, definitions)) {
      return { category: "projection", lowering: "call", path: "rt::TsValue::from_error",
        sourceMode: "value", source: value.source, target: tsValueCarrier, fallible: false };
    }
    const admission = rustTsValueAdmission(value.source, definitions);
    return admission === undefined
      ? undefined
      : {
          category: "projection",
          ...(admission.kind === "call" ? { lowering: "call" as const, path: admission.path }
            : { lowering: "project-closed-value" as const, ownerPath: "rt::TsValue" }),
          sourceMode: "value",
          source: value.source,
          target: tsValueCarrier,
          fallible: false,
        };
  }
  if (value.kind === "js-value-from-closed-carrier") {
    if (!isClosedMetadata(value) || !hasExactObjectKeys(value, ["kind", "source"]) ||
      !isRustTargetTypeRef(value.source)) return undefined;
    if (rustTargetTypeRefEquals(value.source, rustProgramErrorTargetType())) {
      return { category: "projection", lowering: "program-error-closed-value",
        sourceMode: "value", source: value.source, target: jsValueCarrier, fallible: false };
    }
    if (rustClosedValueRetainsError(value.source, definitions)) {
      return { category: "projection", lowering: "call", path: "js_abi::JsValue::from_error",
        sourceMode: "value", source: value.source, target: jsValueCarrier, fallible: false };
    }
    if (rustTargetTypeRefEquals(value.source, rustEmptyObjectTargetType()) || rustJsRecordValueAdmission(value.source) ||
      rustJsSharedObjectValueAdmission(value.source, definitions)) {
      return { category: "projection", lowering: "call", path: "js_abi::JsValue::from",
        sourceMode: "value", source: value.source, target: jsValueCarrier, fallible: false };
    }
    if (rustTsValueAdmission(value.source, definitions)?.kind === "project-object") {
      return { category: "projection", lowering: "project-closed-value", ownerPath: "js_abi::JsValue",
        sourceMode: "value", source: value.source, target: jsValueCarrier, fallible: false };
    }
    return !rustCarrierSupportsClone(value.source, definitions) ||
        !rustCarrierSupportsTrait(value.source, rustJsClosedValueCarrierTraitPath, undefined, undefined, definitions)
      ? undefined
      : {
          category: "projection",
          lowering: "call",
          path: "js_abi::js_value_from_closed",
          sourceMode: "ref",
          source: value.source,
          target: jsValueCarrier,
          fallible: false,
        };
  }
  if (value.kind === "closed-value-from-option") {
    const elementConversion = rustValueConversionContract(value.elementConversion, definitions);
    return !rustTargetTypeRefEquals(rustOptionElementCarrier(value.source), value.element) ||
        elementConversion === undefined || elementConversion.fallible ||
        !rustTargetTypeRefEquals(elementConversion.source, value.element) ||
        (!rustTargetTypeRefEquals(elementConversion.target, jsValueCarrier) &&
          !rustTargetTypeRefEquals(elementConversion.target, tsValueCarrier))
      ? undefined
      : {
          category: "projection",
          lowering: "closed-value-from-option",
          sourceMode: elementConversion.sourceMode,
          source: value.source,
          target: elementConversion.target,
          element: value.element,
          elementConversion,
          fallible: false,
        };
  }
  if (value.kind === "js-array-backing") {
    return !isRustTargetTypeRef(value.element) || !hasExactObjectKeys(value, ["kind", "source", "element"]) ||
      !rustCarrierCanEnterTsValue(value.element, definitions) ||
      (!rustTargetTypeRefEquals(value.source, jsValueCarrier) && !isRustJsArrayValueCarrier(value.source))
      ? undefined : { category: "projection", lowering: "js-array-backing", sourceMode: "ref",
        source: value.source, target: rustJsArrayTargetType(value.element), fallible: true,
        errorBoundary: "provider-native", errorCarrier: rustJsErrorTargetType(),
        element: value.element, method: isRustJsValueCarrier(value.source) ? "cast_array" : "cast" };
  }
  if (value.kind === "js-value-from-array") {
    const elementConversion = rustValueConversionContract(value.elementConversion, definitions);
    return !hasExactObjectKeys(value, ["kind", "source", "element", "elementConversion"]) ||
        !isRustJsArrayCarrier(value.source) || !rustCarrierCanEnterTsValue(value.element, definitions) ||
        !rustTargetTypeRefEquals(
          rustJsArrayLikeElementTargetType(value.source),
          value.element,
        ) || elementConversion === undefined || elementConversion.fallible ||
        !rustTargetTypeRefEquals(elementConversion.source, value.element) ||
        !rustTargetTypeRefEquals(elementConversion.target, jsValueCarrier)
      ? undefined
      : {
          category: "projection",
          lowering: "js-value-from-array",
          sourceMode: "ref",
          source: value.source,
          target: jsValueCarrier,
          element: value.element,
          elementConversion,
          projection: rustTargetTypeRefEquals(value.element, stringCarrier) &&
            elementConversion.lowering === "call" && elementConversion.path === "js_abi::JsValue::from"
            ? "string" : rustTargetTypeRefEquals(value.element, jsValueCarrier) &&
              elementConversion.lowering === "call" && elementConversion.path === "js_abi::clone_js_value"
              ? "value" : "owned",
          fallible: false,
        };
  }
  if (value.kind === "union-fold") {
    if (!isClosedMetadata(value) || !hasExactObjectKeys(value, ["kind", "source", "target", "arms"])) return undefined;
    const leaves = rustUnionLeaves(value.source, definitions);
    if (leaves === undefined || !isRustTargetTypeRef(value.target) ||
        !isDenseDataArray(value.arms) || leaves.length !== value.arms.length) {
      return undefined;
    }
    const arms = value.arms.map((arm, index) => {
      const leaf = leaves[index];
      if (!hasExactObjectKeys(arm, ["carrier", "path", "conversion"]) || leaf === undefined ||
          !closedMetadataEquals(leaf, { carrier: arm.carrier, path: arm.path }) ||
          arm.conversion === null || typeof arm.conversion !== "object") return undefined;
      const conversion = rustValueConversionContract(arm.conversion, definitions);
      return !isRustTargetTypeRef(arm.carrier) ||
          conversion === undefined || conversion.fallible ||
          !rustTargetTypeRefEquals(conversion.source, arm.carrier) ||
          !rustTargetTypeRefEquals(conversion.target, value.target)
        ? undefined
        : { ...leaf, conversion };
    });
    return arms.some((arm) => arm === undefined)
      ? undefined
      : {
          category: "projection",
          lowering: "union-fold",
          sourceMode: arms.every(arm => arm?.conversion.sourceMode === "ref") ? "ref" : "value",
          source: value.source,
          target: value.target,
          arms: arms as NonNullable<typeof arms[number]>[],
          fallible: false,
        };
  }
  if (value.kind === "js-value-from-structural-to-json") {
    const structural = rustStructuralObjectCarrierValue(value.source);
    const field = structural?.fields[value.storageIndex];
    const callable = field?.method === true && field.presence === "required" &&
        field.sourceName === "toJSON"
      ? rustCallableProtocol(field.type)
      : undefined;
    const resultConversion = rustValueConversionContract(value.resultConversion, definitions);
    const parametersMatch = callable?.parameters.length === 0
      ? value.passesPropertyKey === false
      : callable?.parameters.length === 1 &&
        value.passesPropertyKey === true &&
        rustTargetTypeRefEquals(callable.parameters[0], stringCarrier);
    return structural === undefined || field === undefined || callable === undefined ||
        !parametersMatch || !rustTargetTypeRefEquals(callable.result, value.resultCarrier) ||
        resultConversion === undefined || resultConversion.fallible ||
        !rustTargetTypeRefEquals(resultConversion.source, value.resultCarrier) ||
        !rustTargetTypeRefEquals(resultConversion.target, jsValueCarrier) ||
        rustTargetGenericReferences(value.source).lifetimeIdentities.length !== 0
      ? undefined
      : {
          category: "projection",
          lowering: "js-value-from-structural-to-json",
          sourceMode: "value",
          source: value.source,
          target: jsValueCarrier,
          storageIndex: value.storageIndex,
          resultCarrier: value.resultCarrier,
          passesPropertyKey: value.passesPropertyKey,
          resultConversion,
          fallible: false,
        };
  }
  if (value.kind === "js-value-from-properties") {
    const fields = value.fields.map(field => {
      const conversion = rustValueConversionContract(field.conversion, definitions);
      return conversion === undefined || conversion.fallible ||
        !rustTargetTypeRefEquals(conversion.source, field.sourceCarrier) ||
        !rustTargetTypeRefEquals(conversion.target, jsValueCarrier)
        ? undefined : { ...field, conversion };
    });
    return fields.some(field => field === undefined) || new Set(value.fields.map(field => field.sourceName)).size !== value.fields.length
      ? undefined : { category: "projection", lowering: "js-value-from-properties", sourceMode: "ref",
        source: value.source, target: jsValueCarrier, fields: fields as NonNullable<typeof fields[number]>[], fallible: false };
  }
  if (value.kind === "js-value-from-structural-object") {
    const structural = rustStructuralObjectCarrierValue(value.source);
    if (structural === undefined ||
      structural.fields.filter((field) => field.method !== true).length !==
        value.fields.length ||
      new Set(value.fields.map((field) => field.storageIndex)).size !==
        value.fields.length) {
      return undefined;
    }
    const fields = value.fields.map((field) => {
      const sourceField = structural.fields[field.storageIndex];
      const conversion = rustValueConversionContract(field.conversion, definitions);
      const expectedCarrier = sourceField?.presence === "optional"
        ? rustOptionElementCarrier(sourceField.type)
        : sourceField?.type;
      return sourceField === undefined || sourceField.method === true ||
          sourceField.accessor !== undefined ||
          field.sourceName !== sourceField.sourceName ||
          field.presence !== sourceField.presence || expectedCarrier === undefined ||
          !rustTargetTypeRefEquals(field.sourceCarrier, expectedCarrier) ||
          conversion === undefined || conversion.fallible ||
          !rustTargetTypeRefEquals(conversion.source, field.sourceCarrier) ||
          !rustTargetTypeRefEquals(conversion.target, jsValueCarrier)
        ? undefined
        : {
            sourceName: field.sourceName,
            storageIndex: field.storageIndex,
            sourceCarrier: field.sourceCarrier,
            presence: field.presence,
            conversion,
          };
    });
    const selectedStorage = new Set(value.fields.map((field) => field.storageIndex));
    return fields.some((field) => field === undefined) ||
        structural.fields.some((field, index) =>
          field.method !== true && !selectedStorage.has(index))
      ? undefined
      : {
          category: "projection",
          lowering: "js-value-from-structural-object",
          sourceMode: "value",
          source: value.source,
          target: jsValueCarrier,
          fields: fields as NonNullable<typeof fields[number]>[],
          fallible: false,
        };
  }
  if (value.kind === "js-argument-vector-callback") {
    const source = callbackProtocol(value.source);
    const target = rustClosureProtocol(value.target);
    const vectorCarrier = rustJsArrayTargetType(jsValueCarrier);
    const expectedString = value.lane === "native" ? stringCarrier : exactStringCarrier;
    const stringProjection = value.lane === "native" ? "native-string" : "exact-string";
    const restIndexes = value.projections.flatMap((projection, index) =>
      projection === "rest-values" ? [index] : []);
    const projectionsMatch = value.projections.length === source?.parameters.length &&
      value.projections.every((projection, index) => {
        const parameter = source?.parameters[index];
        const expected = projection === stringProjection
          ? expectedString
          : projection === "value"
            ? jsValueCarrier
            : projection === "rest-values" ? vectorCarrier : undefined;
        return parameter !== undefined && expected !== undefined &&
          rustTargetTypeRefEquals(parameter, expected);
      });
    return source === undefined || target === undefined ||
        !rustTargetTypeRefEquals(source.result, expectedString) ||
        target.parameters.length !== 1 ||
        !rustTargetTypeRefEquals(target.parameters[0], vectorCarrier) ||
        !rustTargetTypeRefEquals(target.result, expectedString) ||
        !projectionsMatch || restIndexes.length > 1 ||
        (restIndexes.length === 1 && restIndexes[0] !== value.projections.length - 1) ||
        value.projections.some((projection, index) =>
          (projection === "native-string" || projection === "exact-string") && index !== 0)
      ? undefined
      : {
          category: "exact",
          lowering: "js-argument-vector-callback",
          sourceMode: "value",
          source: value.source,
          target: value.target,
          lane: value.lane,
          projections: value.projections,
          targetResultFallible: target.fallible,
          invocation: rustCallableProtocol(value.source) === undefined ? "invoke" : "call",
          fallible: false,
        };
  }
  if (value.kind === "source-optional") {
    return isRustTargetTypeRef(value.element) ? {
      category: "exact", lowering: "source-optional", sourceMode: "value",
      source: rustOptionTargetType(value.element), target: rustSourceOptionalTargetType(value.element),
      element: value.element, fallible: false,
    } : undefined;
  }
  if (value.kind === "option-some") {
    const element = value.elementConversion === null ? null : rustValueConversionContract(value.elementConversion, definitions);
    return isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.element) &&
      (!isRustAbsenceCarrier(value.source) || rustTargetTypeRefEquals(value.source, value.element)) &&
      (element === null ? rustNativeRepresentationMatches(value.source, value.element) : element !== undefined &&
        rustTargetTypeRefEquals(element.source, value.source) && rustTargetTypeRefEquals(element.target, value.element))
      ? {
          category: element?.category ?? "exact",
          lowering: "option-some",
          sourceMode: "value",
          source: value.source,
          target: rustOptionTargetType(value.element),
          element: element!,
          ...conversionEffect(element),
        }
      : undefined;
  }
  if (value.kind === "option-map") {
    const element = rustValueConversionContract(value.elementConversion, definitions);
    return element === undefined
      ? undefined
      : {
          category: element.category,
          lowering: "option-map",
          sourceMode: "value",
          source: rustOptionTargetType(element.source),
          target: rustOptionTargetType(element.target),
          element,
          ...conversionEffect(element),
        };
  }
  if (value.kind === "bottom-coercion") {
    return isRustNeverCarrier(value.source) && isRustTargetTypeRef(value.target)
      ? {
          category: "exact",
          lowering: "identity",
          sourceMode: "value",
          source: rustNeverTargetType(),
          target: value.target,
          fallible: false,
        }
      : undefined;
  }
  if (value.kind === "source-union-variant") {
    if (!isClosedMetadata(value) ||
      !hasExactObjectKeys(value, ["kind", "source", "target", "variantName", "payloadCarrier", "payloadConversion"]) ||
      !isRustTargetTypeRef(value.source) || !isRustTargetTypeRef(value.target) ||
      !isRustTargetTypeRef(value.payloadCarrier)) return undefined;
    const admission = rustUnionPayloadAdmission(value.source, value.target, definitions);
    if (admission === undefined || admission.path[0]!.variant.name !== value.variantName ||
      !rustTargetTypeRefEquals(admission.carrier, value.payloadCarrier)) return undefined;
    const identical = rustTargetTypeRefEquals(value.source, value.payloadCarrier);
    let payload: RustValueConversionContract | null;
    if (value.payloadConversion === null) {
      if (!identical) return undefined;
      payload = null;
    } else {
      if (identical || value.payloadConversion === undefined || typeof value.payloadConversion !== "object") return undefined;
      const selected = rustValueConversionContract(value.payloadConversion, definitions);
      if (selected === undefined || selected.category !== "exact" && selected.category !== "projection" || selected.fallible ||
        !rustTargetTypeRefEquals(selected.source, value.source) ||
        !rustTargetTypeRefEquals(selected.target, value.payloadCarrier)) return undefined;
      payload = selected;
    }
    return {
      category: "exact",
      lowering: "source-union-variant",
      sourceMode: "value",
      source: value.source,
      target: value.target,
      variantName: value.variantName,
      path: admission.path,
      payloadCarrier: value.payloadCarrier,
      payloadConversion: payload,
      fallible: false,
    };
  }
  if (value.kind === "union-map") {
    const expected = selectRustUnionArmMapping(value.source, value.target, value.coverage, definitions);
    const emission = expected === undefined ? undefined : selectRustUnionMappingEmission(value.source, value.target, expected, value.coverage, false, false, definitions);
    return expected === undefined || emission === undefined || !closedMetadataEquals(expected, value.arms) ? undefined : {
      category: "exact", lowering: "union-map", sourceMode: "value", source: value.source,
      target: value.target, coverage: value.coverage, arms: expected, emission, fallible: false,
    };
  }
  if (value.kind === "union-project") {
    const projection = selectRustUnionProjectionEmission(value.source, value.target, definitions);
    return projection === undefined ? undefined : {
      category: "projection", lowering: "union-project", sourceMode: "value", source: value.source,
      target: value.target, path: projection.path, emission: projection, fallible: false,
    };
  }
  if (value.kind === "raw-pointer-mut-to-const") {
    if (!isRustTargetTypeRef(value.pointee)) {
      return undefined;
    }
    return {
      category: "exact",
      lowering: "identity",
      sourceMode: "value",
      source: {
        kind: "pointer",
        pointee: value.pointee,
        mutability: "mut",
      },
      target: {
        kind: "pointer",
        pointee: value.pointee,
        mutability: "const",
      },
      fallible: false,
    };
  }
  if (value.kind === "copy-from-reference") {
    if (!isRustTargetTypeRef(value.target)) {
      return undefined;
    }
    return {
      category: "ownership",
      lowering: "copy-from-reference",
      sourceMode: "value",
      source: {
        kind: "reference",
        referent: value.target,
        mutable: false,
      },
      target: value.target,
      fallible: false,
    };
  }
  if (value.kind === "numeric-promotion" || value.kind === "integer-refinement") {
    const source = rustSourcePrimitiveTargetType(value.source);
    const target = rustSourcePrimitiveTargetType(value.target);
    const targetType = rustPrimitiveTypeName(value.target);
    return isRustNumericCarrier(source) && isRustNumericCarrier(target) &&
        (value.kind === "numeric-promotion" ? rustNumericValueConversionIsSupported(value.source, value.target)
          : value.proof === "nonnegative" && rustUnsignedIntegerCounterpart(value.source) === value.target) &&
        targetType !== undefined
      ? {
          category: value.kind === "integer-refinement" ? "exact" : "numeric-promotion",
          lowering: "numeric-cast",
          sourceMode: "value",
          source,
          target,
          targetType,
          fallible: false,
        }
      : undefined;
  }
  return selectRustIntrinsicConversionContract(value.id);
}

function conversionEffect(value: RustValueConversionContract | null | undefined): RustValueConversionEffect {
  if (value?.fallible !== true) return { fallible: false };
  return value.errorBoundary === "target-runtime"
    ? { fallible: true, errorBoundary: value.errorBoundary }
    : { fallible: true, errorBoundary: value.errorBoundary, errorCarrier: value.errorCarrier };
}

export function rustValueConversionIsFallible(value: RustValueConversion | undefined, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): boolean {
  return value !== undefined && rustValueConversionContract(value, definitions)?.fallible === true;
}

function callbackProtocol(
  carrier: TargetTypeRef,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  if (carrier.kind === "closure" || carrier.kind === "function-pointer") {
    return { parameters: carrier.args, result: carrier.result };
  }
  return rustCallableProtocol(carrier);
}
