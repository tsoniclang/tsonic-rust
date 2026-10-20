import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { SourceLiteralValue } from "@tsonic/target-api/source";
import { selectRustUnionArmMapping, rustUnionProjectionContract, rustUnionLeaves, type RustUnionLeaf } from "../../target-model/types/union-relations.js";
import { rustNativeRepresentationMatches } from "./native-representation.js";
import { rustCallableInputMatches } from "./callable-input.js";
import { rustUnionPayloadAdmission } from "./union-injection.js";
import { selectRustProgramErrorConversion } from "./program-error.js";
import { rustValueConversionContract } from "./contracts.js";
import { rustNumericValueConversionIsSupported } from "./numeric-promotion.js";
import { selectRustExactIntegerConversion } from "./exact-integer.js";
import { rustClosedValueAdmissionConversion } from "./closed-admission.js";
import { isRustJsArrayCarrier, isRustJsArrayValueCarrier, isRustJsValueCarrier, isRustBigIntCarrier, rustJsNumericTargetType, rustJsStringNumberTargetType, isRustNeverCarrier, isRustAbsenceCarrier, rustJsArrayLikeElementTargetType, rustJsValueTargetType, rustOptionElementCarrier, rustSourcePrimitiveTargetType, rustStringTargetType, rustBorrowedStrTargetType, rustStructuralObjectCarrierValue, rustTsValueTargetType } from "../../target-model/types/index.js";
import { rustCarrierCanEnterTsValue } from "../operations/js-values/carrier-protocols.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustFloat64ToInt32ValueConversion, rustFloat64ToUint8ValueConversion, rustInt32ToFloat64ValueConversion, rustInt32ToUint8ValueConversion, rustIsizeToInt32ValueConversion, rustUint32ToInt32ValueConversion, rustUint64ToFloat64ValueConversion, rustUint8ToInt32ValueConversion, rustUsizeToInt32ValueConversion, rustBorrowedStrToStringValueConversion, rustStringToBorrowedStrValueConversion } from "../../target-model/conversions/model.js";

const int32Carrier = rustSourcePrimitiveTargetType("int32");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const stringCarrier = rustStringTargetType();
const jsValueCarrier = rustJsValueTargetType();
const tsValueCarrier = rustTsValueTargetType();
const float32Carrier = rustSourcePrimitiveTargetType("float32");
const nativeFloat64ToFloat32Conversion: Extract<RustValueConversion, { readonly kind: "semantic-conversion" }> =
  Object.freeze({ kind: "semantic-conversion", id: "native-f64-to-f32" });

export function selectRustKnownNumericValueConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  sourceLiteral: SourceLiteralValue | undefined,
): Extract<RustValueConversion, { readonly kind: "semantic-conversion" }> | undefined {
  return sourceLiteral?.numeric?.kind === "checked-float64"
    ? selectNativeFloat64ToFloat32Conversion(source, target) : undefined;
}

function selectNativeFloat64ToFloat32Conversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
): Extract<RustValueConversion, { readonly kind: "semantic-conversion" }> | undefined {
  return rustTargetTypeRefEquals(source, float64Carrier) && rustTargetTypeRefEquals(target, float32Carrier)
    ? nativeFloat64ToFloat32Conversion : undefined;
}

export function selectRustSourceValueConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
  ancestors: readonly {readonly source: TargetTypeRef; readonly target: TargetTypeRef}[] = [],
): RustValueConversion | undefined {
  if (ancestors.some(ancestor => rustTargetTypeRefEquals(ancestor.source, source) &&
    rustTargetTypeRefEquals(ancestor.target, target))) return undefined;
  const nextAncestors = [...ancestors, {source, target}];
  if (rustTargetTypeRefEquals(source, rustBorrowedStrTargetType()) && rustTargetTypeRefEquals(target, stringCarrier)) {
    return rustBorrowedStrToStringValueConversion;
  }
  if (rustTargetTypeRefEquals(source, stringCarrier) && rustTargetTypeRefEquals(target, rustBorrowedStrTargetType())) {
    return rustStringToBorrowedStrValueConversion;
  }
  if (!rustTargetTypeRefEquals(source, target) && rustCallableInputMatches(source, target)) {
    return { kind: "callable-input", source, target };
  }
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
      return rustClosedValueAdmissionConversion(source, target, definitions);
    }
    if (sourceOptionElement !== undefined) {
      const elementConversion = selectRustSourceValueConversion(sourceOptionElement, target, definitions, nextAncestors);
      return elementConversion === undefined || elementConversion.kind === "option-map" ||
        elementConversion.kind === "option-some" ? undefined : {
          kind: "closed-value-from-option", source, element: sourceOptionElement, elementConversion,
        };
    }
    const leaves = rustUnionLeaves(source, definitions);
    if (leaves !== undefined) return selectRustUnionFoldConversion(source, target, leaves, leaves.map(leaf =>
      selectRustSourceValueConversion(leaf.carrier, target, definitions, nextAncestors)));
    return rustClosedValueAdmissionConversion(source, target, definitions);
  }
  if (rustTargetTypeRefEquals(target, jsValueCarrier)) {
    const admission = rustClosedValueAdmissionConversion(source, target, definitions);
    if (admission !== undefined) return admission;
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
      return selectRustUnionFoldConversion(source, jsValueCarrier, unionLeaves, unionLeaves.map(leaf =>
        selectRustSourceValueConversion(leaf.carrier, jsValueCarrier, definitions, nextAncestors)));
    }
    const structural = rustStructuralObjectCarrierValue(source);
    if (structural !== undefined) {
      const fields = selectRustStructuralObjectConversionFields(
        structural,
        new Map(structural.fields.map(field => {
          const carrier = field.presence === "optional" ? rustOptionElementCarrier(field.type) : field.type;
          return [field.type, carrier === undefined ? undefined : selectRustSourceValueConversion(carrier, jsValueCarrier, definitions, nextAncestors)] as const;
        })),
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
  sourceLiteral: SourceLiteralValue | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueConversion | undefined {
  if (rustUnionProjectionContract(source, target, definitions) !== undefined) return { kind: "union-project", source, target };
  const mapping = selectRustUnionArmMapping(source, target, "target", definitions);
  if (mapping !== undefined) return { kind: "union-map", source, target, coverage: "target", arms: mapping };
  if (source.kind === "source-primitive" && target.kind === "source-primitive" && target.name === "int32") {
    if (source.name === "native-int") return rustIsizeToInt32ValueConversion;
    if (source.name === "native-uint") return rustUsizeToInt32ValueConversion;
  }
  const nativeFloat = sourceLiteral?.numeric?.kind === "authored"
    ? undefined : selectNativeFloat64ToFloat32Conversion(source, target);
  if (nativeFloat !== undefined) return nativeFloat;
  const conversion = selectRustSourceValueConversion(source, target, definitions);
  return conversion ?? selectRustExactIntegerConversion(source, target);
}

export function selectRustUnionFoldConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  leaves: readonly RustUnionLeaf[],
  conversions: readonly (RustValueConversion | undefined)[],
): Extract<RustValueConversion, { readonly kind: "union-fold" }> | undefined {
  const arms: Extract<RustValueConversion, { readonly kind: "union-fold" }>["arms"][number][] = [];
  if (leaves.length !== conversions.length) return undefined;
  for (const [index, leaf] of leaves.entries()) {
    const conversion = conversions[index];
    if (conversion === undefined || conversion.kind === "option-map" || conversion.kind === "option-some") return undefined;
    arms.push(Object.freeze({ ...leaf, conversion }));
  }
  return Object.freeze({ kind: "union-fold", source, target, arms: Object.freeze(arms) });
}

type StructuralObjectConversion = Extract<
  RustValueConversion,
  { readonly kind: "js-value-from-structural-object" }
>;

export function selectRustStructuralObjectConversionFields(
  structural: NonNullable<ReturnType<typeof rustStructuralObjectCarrierValue>>,
  conversions: ReadonlyMap<TargetTypeRef, RustValueConversion | undefined>,
): StructuralObjectConversion["fields"] | undefined {
  const fields: StructuralObjectConversion["fields"][number][] = [];
  for (const [storageIndex, field] of structural.fields.entries()) {
    if (field.method === true) continue;
    if (field.accessor !== undefined) return undefined;
    const sourceCarrier = field.presence === "optional"
      ? rustOptionElementCarrier(field.type)
      : field.type;
    if (sourceCarrier === undefined) return undefined;
    const conversion = conversions.get(field.type);
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
