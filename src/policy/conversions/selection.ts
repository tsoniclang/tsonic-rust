import type { RustValueConversion } from "../../target-model/operations/model.js";
import { rustNumericPromotionKind } from "../../target-model/conversions/numeric-promotion.js";
import {
  isRustJsArrayCarrier,
  isRustNeverCarrier,
  isRustNullCarrier,
  isRustUndefinedCarrier,
  rustCarrierSupportsClone,
  rustCarrierCanEnterTsValue,
  rustCarrierSupportsTrait,
  rustJsClosedValueCarrierTraitPath,
  rustJsArrayLikeElementTargetType,
  rustJsSymbolTargetType,
  rustJsValueTargetType,
  rustOptionElementCarrier,
  rustSourcePrimitiveTargetType,
  rustSourceUnionCarrierValue,
  rustStringTargetType,
  rustStructuralObjectCarrierValue,
  rustCallableProtocol,
  rustTargetGenericReferences,
  rustTsValueTargetType,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  rustBoolToJsValueConversion,
  rustFloat64ToInt32ValueConversion,
  rustFloat64ToJsValueConversion,
  rustInt32ToFloat64ValueConversion,
  rustInt32ToJsValueConversion,
  rustInt32ToUint8ValueConversion,
  rustJsValueCloneConversion,
  rustTsValueCloneConversion,
  rustNullToJsValueConversion,
  rustStringToJsValueConversion,
  rustSymbolToJsValueConversion,
  rustUndefinedToJsValueConversion,
  rustUint32ToInt32ValueConversion,
  rustUint64ToFloat64ValueConversion,
  rustUint8ToInt32ValueConversion,
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
): RustValueConversion | undefined {
  const sourceOptionElement = rustOptionElementCarrier(source);
  const targetOptionElement = rustOptionElementCarrier(target);
  if (sourceOptionElement !== undefined && targetOptionElement !== undefined) {
    const elementConversion = selectRustSourceValueConversion(
      sourceOptionElement,
      targetOptionElement,
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
  const targetUnion = rustSourceUnionCarrierValue(target);
  const matchingUnionVariants = targetUnion?.variants.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, source)) ?? [];
  if (matchingUnionVariants.length === 1) {
    return Object.freeze({
      kind: "source-union-variant",
      source,
      target,
      variantName: matchingUnionVariants[0]!.name,
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
    return rustCarrierCanEnterTsValue(source)
      ? Object.freeze({
          kind: "ts-value-from-closed-carrier" as const,
          source,
        })
      : undefined;
  }
  if (rustTargetTypeRefEquals(target, jsValueCarrier)) {
    if (rustTargetTypeRefEquals(source, jsValueCarrier)) {
      return rustJsValueCloneConversion;
    }
    if (rustTargetTypeRefEquals(source, boolCarrier)) {
      return rustBoolToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, float64Carrier)) {
      return rustFloat64ToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, int32Carrier)) {
      return rustInt32ToJsValueConversion;
    }
    if (isRustNullCarrier(source)) {
      return rustNullToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, stringCarrier)) {
      return rustStringToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, symbolCarrier)) {
      return rustSymbolToJsValueConversion;
    }
    if (isRustUndefinedCarrier(source)) {
      return rustUndefinedToJsValueConversion;
    }
    if (rustCarrierSupportsClone(source) &&
      rustCarrierSupportsTrait(source, rustJsClosedValueCarrierTraitPath)) {
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
      );
      return elementConversion === undefined ||
          elementConversion.kind === "option-map" ||
          elementConversion.kind === "option-some"
        ? undefined
        : Object.freeze({
            kind: "js-value-from-option" as const,
            source,
            element: optionElement,
            elementConversion,
          });
    }
    const arrayElement = isRustJsArrayCarrier(source)
      ? rustJsArrayLikeElementTargetType(source)
      : undefined;
    if (arrayElement !== undefined && rustCarrierSupportsClone(arrayElement)) {
      const elementConversion = selectRustSourceValueConversion(
        arrayElement,
        jsValueCarrier,
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
    const sourceUnion = rustSourceUnionCarrierValue(source);
    if (sourceUnion !== undefined) {
      const variants = sourceUnion.variants.map((variant) => {
        if (rustTargetTypeRefEquals(variant.carrier, source)) {
          return undefined;
        }
        const conversion = selectRustSourceValueConversion(
          variant.carrier,
          jsValueCarrier,
        );
        return conversion === undefined ||
            conversion.kind === "option-map" ||
            conversion.kind === "option-some"
          ? undefined
          : Object.freeze({
              name: variant.name,
              carrier: variant.carrier,
              conversion,
            });
      });
      return variants.length === 0 || variants.some((variant) => variant === undefined)
        ? undefined
        : Object.freeze({
            kind: "js-value-from-source-union" as const,
            source,
            variants: Object.freeze(
              variants as NonNullable<typeof variants[number]>[],
            ),
          });
    }
    const structural = rustStructuralObjectCarrierValue(source);
    if (structural !== undefined) {
      const fields = selectStructuralObjectConversionFields(
        structural,
        (sourceCarrier) => selectRustSourceValueConversion(sourceCarrier, jsValueCarrier),
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
  return source.name !== target.name &&
      rustNumericPromotionKind(source.name, target.name) === target.name
    ? { kind: "numeric-promotion", source: source.name, target: target.name }
    : undefined;
}

export function selectRustJsonValueConversion(
  source: TargetTypeRef,
): RustValueConversion | undefined {
  return selectJsonValueConversion(source, true, []);
}

function selectJsonValueConversion(
  source: TargetTypeRef,
  applySelectedToJson: boolean,
  ancestors: readonly TargetTypeRef[],
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
      : selectJsonValueConversion(callable.result, false, nextAncestors);
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
    );
    return elementConversion === undefined ||
        elementConversion.kind === "option-map" ||
        elementConversion.kind === "option-some"
      ? undefined
      : Object.freeze({
          kind: "js-value-from-option" as const,
          source,
          element: optionElement,
          elementConversion,
        });
  }
  const arrayElement = isRustJsArrayCarrier(source)
    ? rustJsArrayLikeElementTargetType(source)
    : undefined;
  if (arrayElement !== undefined && rustCarrierSupportsClone(arrayElement)) {
    const elementConversion = selectJsonValueConversion(
      arrayElement,
      true,
      nextAncestors,
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
  const sourceUnion = rustSourceUnionCarrierValue(source);
  if (sourceUnion !== undefined) {
    const variants = sourceUnion.variants.map((variant) => {
      const conversion = selectJsonValueConversion(
        variant.carrier,
        applySelectedToJson,
        nextAncestors,
      );
      return conversion === undefined ||
          conversion.kind === "option-map" ||
          conversion.kind === "option-some"
        ? undefined
        : Object.freeze({
            name: variant.name,
            carrier: variant.carrier,
            conversion,
          });
    });
    return variants.length === 0 || variants.some((variant) => variant === undefined)
      ? undefined
      : Object.freeze({
          kind: "js-value-from-source-union" as const,
          source,
          variants: Object.freeze(
            variants as NonNullable<typeof variants[number]>[],
          ),
        });
  }
  if (structural !== undefined) {
    const fields = selectStructuralObjectConversionFields(
      structural,
      (sourceCarrier) => selectJsonValueConversion(sourceCarrier, true, nextAncestors),
    );
    return fields === undefined ? undefined : Object.freeze({
      kind: "js-value-from-structural-object" as const,
      source,
      fields,
    });
  }
  return selectRustSourceValueConversion(source, jsValueCarrier);
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
