import type { RustValueConversion } from "../../target-model/operations/model.js";
import { selectRustUnionArmMapping, rustUnionProjectionContract, rustUnionLeaves, type RustUnionLeaf } from "../../target-model/types/union-relations.js";
import { rustNativeRepresentationMatches } from "../../target-model/conversions/native-representation.js";
import { rustUnionPayloadAdmission } from "../../target-model/conversions/union-injection.js";
import { selectRustProgramErrorConversion } from "../../target-model/conversions/program-error.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustNumericValueConversionIsSupported } from "../../target-model/conversions/numeric-promotion.js";
import { selectRustExactIntegerConversion } from "../../target-model/conversions/exact-integer.js";
import { rustNumberBoxingConversionId } from "../../target-model/conversions/number-boxing.js";
import {
  isRustJsArrayCarrier,
  isRustJsArrayValueCarrier,
  isRustJsValueCarrier,
  isRustBigIntCarrier,
  rustJsNumericTargetType,
  rustJsStringNumberTargetType,
  isRustNeverCarrier,
  isRustAbsenceCarrier,
  rustCarrierSupportsClone,
  rustCarrierCanEnterTsValue,
  rustTsValueAdmission,
  rustCarrierSupportsTrait,
  rustJsClosedValueCarrierTraitPath,
  rustJsArrayLikeElementTargetType,
  rustJsSymbolTargetType,
  rustJsValueTargetType,
  rustJsErrorTargetType,
  rustEmptyObjectTargetType,
  rustOptionElementCarrier,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustStructuralObjectCarrierValue,
  rustCallableProtocol,
  rustTargetGenericReferences,
  rustTsValueTargetType,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import { rustJsRecordValueAdmission } from "../../target-model/conversions/closed-record.js";
import { rustClosedValueRetainsError } from "../../target-model/types/carriers/closed-values.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import {
  rustBoolToJsValueConversion,
  rustFloat64ToInt32ValueConversion,
  rustFloat64ToUint8ValueConversion,
  rustInt32ToFloat64ValueConversion,
  rustInt32ToUint8ValueConversion,
  rustIsizeToInt32ValueConversion,
  rustJsValueCloneConversion,
  rustTsValueCloneConversion,
  rustAbsenceToJsValueConversion,
  rustStringToJsValueConversion,
  rustSymbolToJsValueConversion,
  rustUint32ToInt32ValueConversion,
  rustUint64ToFloat64ValueConversion,
  rustUint8ToInt32ValueConversion,
  rustUsizeToInt32ValueConversion,
} from "../../target-model/conversions/model.js";

const boolCarrier = rustSourcePrimitiveTargetType("bool");
const int32Carrier = rustSourcePrimitiveTargetType("int32");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const stringCarrier = rustStringTargetType();
const symbolCarrier = rustJsSymbolTargetType();
const jsValueCarrier = rustJsValueTargetType();
const tsValueCarrier = rustTsValueTargetType();

export function selectRustSourceValueConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  ancestors: readonly {readonly source: TargetTypeRef; readonly target: TargetTypeRef}[] = [],
): RustValueConversion | undefined {
  if (ancestors.some(ancestor => rustTargetTypeRefEquals(ancestor.source, source) &&
    rustTargetTypeRefEquals(ancestor.target, target))) return undefined;
  const nextAncestors = [...ancestors, {source, target}];
  if (!rustTargetTypeRefEquals(source, target)) {
    const error = selectRustProgramErrorConversion(source, target, definitions);
    if (error !== undefined) return error;
  }
  const nativeArrayElement = isRustJsArrayCarrier(target) ? rustJsArrayLikeElementTargetType(target) : undefined;
  if (nativeArrayElement !== undefined && rustCarrierCanEnterTsValue(nativeArrayElement, definitions) &&
    (isRustJsValueCarrier(source) || isRustJsArrayValueCarrier(source))) {
    return { kind: "js-array-backing", source, element: nativeArrayElement };
  }
  if (!rustTargetTypeRefEquals(source, target) && rustNativeRepresentationMatches(source, target)) {
    return { kind: "native-representation", source, target };
  }
  const upcasts = rustNamedTypeCarrierValue(source)?.upcasts.filter((upcast) =>
    rustTargetTypeRefEquals(upcast.target, target)) ?? [];
  if (upcasts.length === 1) {
    return { kind: "native-upcast", source, target, path: upcasts[0]!.path };
  }
  if (rustTargetTypeRefEquals(target, rustJsNumericTargetType())) {
    if (isRustBigIntCarrier(source)) return { kind: "semantic-conversion", id: "js-numeric-from-bigint" };
    if (rustTargetTypeRefEquals(source, float64Carrier)) return { kind: "semantic-conversion", id: "js-numeric-from-number" };
    if (rustTargetTypeRefEquals(source, int32Carrier)) return { kind: "semantic-conversion", id: "js-numeric-from-int32" };
  }
  if (rustTargetTypeRefEquals(target, rustJsStringNumberTargetType())) {
    if (rustTargetTypeRefEquals(source, stringCarrier)) return { kind: "semantic-conversion", id: "js-string-number-from-string" };
    if (rustTargetTypeRefEquals(source, float64Carrier)) return { kind: "semantic-conversion", id: "js-string-number-from-number" };
    if (rustTargetTypeRefEquals(source, int32Carrier)) return { kind: "semantic-conversion", id: "js-string-number-from-int32" };
  }
  const sourceOptionElement = rustOptionElementCarrier(source);
  const targetOptionElement = rustOptionElementCarrier(target);
  if (targetOptionElement !== undefined && (rustTargetTypeRefEquals(source, targetOptionElement) ||
    !isRustAbsenceCarrier(source) && rustNativeRepresentationMatches(source, targetOptionElement))) {
    return { kind: "option-some", source, element: targetOptionElement, elementConversion: null };
  }
  if (targetOptionElement !== undefined && sourceOptionElement === undefined && !isRustAbsenceCarrier(source)) {
    const elementConversion = selectRustSourceValueConversion(source, targetOptionElement, definitions, nextAncestors);
    if (elementConversion !== undefined && elementConversion.kind !== "option-map" && elementConversion.kind !== "option-some") {
      return { kind: "option-some", source, element: targetOptionElement, elementConversion };
    }
  }
  if (sourceOptionElement !== undefined && targetOptionElement !== undefined) {
    const elementConversion = selectRustSourceValueConversion(
      sourceOptionElement,
      targetOptionElement,
      definitions, nextAncestors,
    );
    if (elementConversion === undefined || elementConversion.kind === "option-map" ||
      elementConversion.kind === "option-some") {
      return undefined;
    }
    return { kind: "option-map", elementConversion };
  }
  if (isRustNeverCarrier(source)) {
    return Object.freeze({ kind: "bottom-coercion", source, target });
  }
  const unionMapping = selectRustUnionArmMapping(source, target, "source", definitions);
  if (unionMapping !== undefined) return { kind: "union-map", source, target, coverage: "source", arms: unionMapping };
  const injection = rustUnionPayloadAdmission(source, target, definitions);
  if (injection !== undefined) {
    const payloadConversion = rustTargetTypeRefEquals(source, injection.carrier) ? null :
      selectRustSourceValueConversion(source, injection.carrier, definitions, nextAncestors);
    const payload = payloadConversion == null ? undefined : rustValueConversionContract(payloadConversion, definitions);
    if (payloadConversion === undefined || payloadConversion !== null && (payload === undefined ||
      payload.category !== "exact" && payload.category !== "projection" || payload.fallible ||
      !rustTargetTypeRefEquals(payload.source, source) ||
      !rustTargetTypeRefEquals(payload.target, injection.carrier))) return undefined;
    return Object.freeze({
      kind: "source-union-variant",
      source,
      target,
      variantName: injection.path[0]!.variant.name,
      payloadCarrier: injection.carrier,
      payloadConversion,
    });
  }
  if (source.kind === "pointer" && target.kind === "pointer" &&
    source.mutability === "mut" && target.mutability === "const" &&
    rustTargetTypeRefEquals(source.pointee, target.pointee)) {
    return Object.freeze({
      kind: "raw-pointer-mut-to-const",
      pointee: source.pointee,
    });
  }
  if (rustTargetTypeRefEquals(target, tsValueCarrier)) {
    if (rustTargetTypeRefEquals(source, tsValueCarrier)) {
      return rustTsValueCloneConversion;
    }
    if (sourceOptionElement !== undefined) {
      const elementConversion = selectRustSourceValueConversion(sourceOptionElement, target, definitions, nextAncestors);
      return elementConversion === undefined || elementConversion.kind === "option-map" ||
        elementConversion.kind === "option-some" ? undefined : {
          kind: "closed-value-from-option", source, element: sourceOptionElement, elementConversion,
        };
    }
    const leaves = rustUnionLeaves(source, definitions);
    if (leaves !== undefined) return selectUnionFold(source, target, leaves, carrier =>
      selectRustSourceValueConversion(carrier, target, definitions, nextAncestors));
    return rustClosedValueRetainsError(source, definitions) || rustTsValueAdmission(source, definitions) !== undefined
      ? Object.freeze({
          kind: "ts-value-from-closed-carrier" as const,
          source,
        })
      : undefined;
  }
  if (rustTargetTypeRefEquals(target, jsValueCarrier)) {
    if (rustTargetTypeRefEquals(source, rustJsErrorTargetType())) {
      return { kind: "semantic-conversion", id: "js-value-from-error" };
    }
    if (rustTargetTypeRefEquals(source, jsValueCarrier)) {
      return rustJsValueCloneConversion;
    }
    if (rustTargetTypeRefEquals(source, boolCarrier)) {
      return rustBoolToJsValueConversion;
    }
    const numberBoxing = source.kind === "source-primitive"
      ? rustNumberBoxingConversionId(source.name)
      : undefined;
    if (numberBoxing !== undefined) {
      return Object.freeze({ kind: "semantic-conversion", id: numberBoxing });
    }
    if (isRustAbsenceCarrier(source)) {
      return rustAbsenceToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, stringCarrier)) {
      return rustStringToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, symbolCarrier)) {
      return rustSymbolToJsValueConversion;
    }
    if (rustClosedValueRetainsError(source, definitions) || rustTargetTypeRefEquals(source, rustEmptyObjectTargetType()) ||
      rustJsRecordValueAdmission(source) || rustTsValueAdmission(source, definitions)?.kind === "project-object" ||
      rustCarrierSupportsClone(source, definitions) &&
      rustCarrierSupportsTrait(source, rustJsClosedValueCarrierTraitPath, undefined, undefined, definitions)) {
      return Object.freeze({
        kind: "js-value-from-closed-carrier" as const,
        source,
      });
    }
    const optionElement = rustOptionElementCarrier(source);
    if (optionElement !== undefined) {
      const elementConversion = selectRustSourceValueConversion(
        optionElement,
        jsValueCarrier,
        definitions, nextAncestors,
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
    if (arrayElement !== undefined && rustCarrierCanEnterTsValue(arrayElement, definitions)) {
      const elementConversion = selectRustSourceValueConversion(
        arrayElement,
        jsValueCarrier,
        definitions, nextAncestors,
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
      return selectUnionFold(source, jsValueCarrier, unionLeaves, carrier =>
        selectRustSourceValueConversion(carrier, jsValueCarrier, definitions, nextAncestors));
    }
    const structural = rustStructuralObjectCarrierValue(source);
    if (structural !== undefined) {
      const fields = selectStructuralObjectConversionFields(
        structural,
        (sourceCarrier) => selectRustSourceValueConversion(sourceCarrier, jsValueCarrier, definitions, nextAncestors),
      );
      return fields === undefined ? undefined : Object.freeze({
        kind: "js-value-from-structural-object" as const,
        source,
        fields,
      });
    }
    return undefined;
  }
  if (source.kind !== "source-primitive" || target.kind !== "source-primitive") {
    return undefined;
  }
  if (source.name === "float64" && target.name === "int32") {
    return rustFloat64ToInt32ValueConversion;
  }
  if (source.name === "float64" && target.name === "uint8") {
    return rustFloat64ToUint8ValueConversion;
  }
  if (source.name === "int32" && target.name === "uint8") {
    return rustInt32ToUint8ValueConversion;
  }
  if (source.name === "uint8" && target.name === "int32") {
    return rustUint8ToInt32ValueConversion;
  }
  if (source.name === "int32" && target.name === "float64") {
    return rustInt32ToFloat64ValueConversion;
  }
  if (source.name === "uint32" && target.name === "int32") {
    return rustUint32ToInt32ValueConversion;
  }
  if (source.name === "uint64" && target.name === "float64") {
    return rustUint64ToFloat64ValueConversion;
  }
  if (source.name === "native-int" && (target.name === "int64" || target.name === "int128") ||
    source.name === "native-uint" && (target.name === "uint64" || target.name === "uint128")) {
    return selectRustExactIntegerConversion(source, target);
  }
  return rustNumericValueConversionIsSupported(source.name, target.name)
    ? { kind: "numeric-promotion", source: source.name, target: target.name }
    : undefined;
}

export function selectRustSourceAssertionConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueConversion | undefined {
  if (rustUnionProjectionContract(source, target, definitions) !== undefined) return { kind: "union-project", source, target };
  const mapping = selectRustUnionArmMapping(source, target, "target", definitions);
  if (mapping !== undefined) return { kind: "union-map", source, target, coverage: "target", arms: mapping };
  if (source.kind === "source-primitive" && target.kind === "source-primitive" && target.name === "int32") {
    if (source.name === "native-int") return rustIsizeToInt32ValueConversion;
    if (source.name === "native-uint") return rustUsizeToInt32ValueConversion;
  }
  const conversion = selectRustSourceValueConversion(source, target, definitions);
  return conversion ?? selectRustExactIntegerConversion(source, target);
}

export function selectRustJsonValueConversion(
  source: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueConversion | undefined {
  return selectJsonValueConversion(source, true, [], definitions);
}

function selectJsonValueConversion(
  source: TargetTypeRef,
  applySelectedToJson: boolean,
  ancestors: readonly TargetTypeRef[],
  definitions: RustTypeDefinitions,
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
      : selectJsonValueConversion(callable.result, false, nextAncestors, definitions);
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
    const elementConversion = selectJsonValueConversion(
      optionElement,
      applySelectedToJson,
      nextAncestors,
      definitions,
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
    const elementConversion = selectJsonValueConversion(
      arrayElement,
      true,
      nextAncestors,
      definitions,
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
    return selectUnionFold(source, jsValueCarrier, unionLeaves, carrier =>
      selectJsonValueConversion(carrier, applySelectedToJson, nextAncestors, definitions));
  }
  if (structural !== undefined) {
    const fields = selectStructuralObjectConversionFields(
      structural,
      (sourceCarrier) => selectJsonValueConversion(sourceCarrier, true, nextAncestors, definitions),
    );
    return fields === undefined ? undefined : Object.freeze({
      kind: "js-value-from-structural-object" as const,
      source,
      fields,
    });
  }
  return selectRustSourceValueConversion(source, jsValueCarrier, definitions);
}

function selectUnionFold(
  source: TargetTypeRef,
  target: TargetTypeRef,
  leaves: readonly RustUnionLeaf[],
  select: (carrier: TargetTypeRef) => RustValueConversion | undefined,
): Extract<RustValueConversion, { readonly kind: "union-fold" }> | undefined {
  const arms: Extract<RustValueConversion, { readonly kind: "union-fold" }>["arms"][number][] = [];
  for (const leaf of leaves) {
    const conversion = select(leaf.carrier);
    if (conversion === undefined || conversion.kind === "option-map" || conversion.kind === "option-some") return undefined;
    arms.push(Object.freeze({ ...leaf, conversion }));
  }
  return Object.freeze({ kind: "union-fold", source, target, arms: Object.freeze(arms) });
}

type StructuralObjectConversion = Extract<
  RustValueConversion,
  { readonly kind: "js-value-from-structural-object" }
>;

function selectStructuralObjectConversionFields(
  structural: NonNullable<ReturnType<typeof rustStructuralObjectCarrierValue>>,
  select: (sourceCarrier: TargetTypeRef) => RustValueConversion | undefined,
): StructuralObjectConversion["fields"] | undefined {
  const fields: StructuralObjectConversion["fields"][number][] = [];
  for (const [storageIndex, field] of structural.fields.entries()) {
    if (field.method === true) continue;
    if (field.accessor !== undefined) return undefined;
    const sourceCarrier = field.presence === "optional"
      ? rustOptionElementCarrier(field.type)
      : field.type;
    if (sourceCarrier === undefined) return undefined;
    const conversion = select(sourceCarrier);
    if (conversion === undefined || conversion.kind === "option-map" ||
      conversion.kind === "option-some") {
      return undefined;
    }
    fields.push(Object.freeze({
      sourceName: field.sourceName,
      storageIndex,
      sourceCarrier,
      presence: field.presence,
      conversion,
    }));
  }
  return Object.freeze(fields);
}
