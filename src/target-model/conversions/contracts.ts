import type { TargetTypeRef } from "../types/model.js";
import { rustNativeRepresentationMatches } from "./native-representation.js";
import { rustJsRecordValueAdmission } from "./closed-record.js";
import {
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../types/equality.js";
import type {
  RustValueConversion,
  RustValueConversionId,
} from "../operations/model.js";
import {
  isRustAbsenceCarrier,
  isRustNeverCarrier,
  rustJsNumericTargetType,
  rustJsStringNumberTargetType,
  rustBigIntTargetType,
  isRustNumericCarrier,
  rustCallableProtocol,
  rustClosureProtocol,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustJsSymbolTargetType,
  rustNeverTargetType,
  rustOptionTargetType,
  rustSourceOptionalTargetType,
  rustJsValueTargetType,
  rustJsErrorTargetType,
  rustEmptyObjectTargetType,
  rustOptionElementCarrier,
  rustPrimitiveTypeName,
  rustSourcePrimitiveTargetType,
  rustBorrowedStrTargetType,
  rustStringTargetType,
  rustStrTargetType,
  rustStructuralObjectCarrierValue,
  rustJsArrayLikeElementTargetType,
  isRustJsArrayCarrier,
  isRustJsArrayValueCarrier,
  isRustJsValueCarrier,
  rustAbsenceTargetType,
  rustTargetGenericReferences,
  rustCarrierSupportsClone,
  rustCarrierCanEnterTsValue,
  rustTsValueAdmission,
  rustCarrierSupportsTrait,
  rustJsClosedValueCarrierTraitPath,
  rustTsValueTargetType,
} from "../types/index.js";
import type { RustPrimitiveTypeName } from "../syntax/tokens.js";
import { rustNumericValueConversionIsSupported } from "./numeric-promotion.js";
import { rustExactIntegerConversionMatches } from "./exact-integer.js";
import { rustUnsignedIntegerCounterpart } from "./integer-refinement.js";
import { rustNumberBoxingSourceKind } from "./number-boxing.js";
import { rustRestSequenceElements } from "../operations/rest-assembly.js";
import { closedMetadataEquals, isClosedMetadata, isDenseDataArray, hasExactObjectKeys } from "../metadata/closed-data.js";
import { rustNamedTypeCarrierValue } from "../types/carriers/native.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../types/source-union-definitions.js";
import { rustUnionInjectionPath, selectRustUnionArmMapping, rustUnionProjectionContract, rustUnionLeaves, type RustUnionLeaf, type RustUnionArmMapping, type RustUnionPathStep } from "../types/union-relations.js";

const boolCarrier = rustSourcePrimitiveTargetType("bool");
const int32Carrier = rustSourcePrimitiveTargetType("int32");
const uint8Carrier = rustSourcePrimitiveTargetType("uint8");
const uint32Carrier = rustSourcePrimitiveTargetType("uint32");
const uint64Carrier = rustSourcePrimitiveTargetType("uint64");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const usizeCarrier = rustSourcePrimitiveTargetType("native-uint");
const isizeCarrier = rustSourcePrimitiveTargetType("native-int");
const stringCarrier = rustStringTargetType();
const exactStringCarrier = rustJsStringTargetType();
const symbolCarrier = rustJsSymbolTargetType();
const jsValueCarrier = rustJsValueTargetType();
const tsValueCarrier = rustTsValueTargetType();
const absenceCarrier = rustAbsenceTargetType();

interface RustValueConversionContractBase {
  readonly category: "exact" | "checked-range" | "js-number" | "numeric-promotion" | "ownership" | "projection";
  readonly sourceMode: "value" | "ref";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly fallible: boolean;
}

export type RustValueConversionContract = RustValueConversionContractBase & (
  | { readonly lowering: "project-closed-value"; readonly ownerPath: "rt::TsValue" | "js_abi::JsValue" }
  | { readonly lowering: "js-array-backing"; readonly element: TargetTypeRef; readonly method: "cast" | "cast_array" }
  | { readonly lowering: "source-optional"; readonly element: TargetTypeRef }
  | { readonly lowering: "union-project" }
  | { readonly lowering: "union-map"; readonly coverage: "source" | "target"; readonly arms: readonly RustUnionArmMapping[] }
  | { readonly lowering: "exact-integer" }
  | {
      readonly lowering: "rest-sequence";
      readonly collection: "vec" | "js-array" | "fixed-array" | "tuple" | "slice";
      readonly elementConversions: readonly (RustValueConversionContract | null)[];
      readonly cloneSources: readonly TargetTypeRef[];
    }
  | {
      readonly lowering: "call";
      readonly path: string;
    }
  | {
      readonly lowering: "numeric-cast";
      readonly targetType: RustPrimitiveTypeName;
    }
  | {
      readonly lowering: "identity";
    }
  | {
      readonly lowering: "source-union-variant";
      readonly variantName: string;
      readonly path: readonly RustUnionPathStep[];
    }
  | {
      readonly lowering: "option-map";
      readonly element: RustValueConversionContract;
    }
  | {
      readonly lowering: "option-some";
    }
  | {
      readonly lowering: "js-argument-vector-callback";
      readonly lane: "native" | "exact";
      readonly projections: readonly (
        | "native-string"
        | "exact-string"
        | "value"
        | "rest-values"
      )[];
      readonly sourceFallible: boolean;
    }
  | {
      readonly lowering: "owned-string-from-borrowed-str";
    }
  | {
      readonly lowering: "borrowed-str-from-owned-string" | "borrowed-str-from-optional-string";
    }
  | {
      readonly lowering: "copy-from-reference";
    }
  | {
      readonly lowering: "closed-value-from-option";
      readonly element: TargetTypeRef;
      readonly elementConversion: RustValueConversionContract;
    }
  | {
      readonly lowering: "js-value-from-array";
      readonly element: TargetTypeRef;
      readonly elementConversion: RustValueConversionContract;
      readonly projection: "string" | "value" | "owned";
    }
  | {
      readonly lowering: "union-fold";
      readonly arms: readonly (RustUnionLeaf & {
        readonly conversion: RustValueConversionContract;
      })[];
    }
  | {
      readonly lowering: "js-value-from-structural-to-json";
      readonly storageIndex: number;
      readonly resultCarrier: TargetTypeRef;
      readonly passesPropertyKey: boolean;
      readonly resultConversion: RustValueConversionContract;
    }
  | {
      readonly lowering: "js-value-from-structural-object";
      readonly fields: readonly {
        readonly sourceName: string;
        readonly storageIndex: number;
        readonly sourceCarrier: TargetTypeRef;
        readonly presence: "required" | "optional";
        readonly conversion: RustValueConversionContract;
      }[];
    }
);

export function rustValueConversionContract(
  value: RustValueConversion,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustValueConversionContract | undefined {
  if (value.kind === "exact-integer") {
    return isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      rustExactIntegerConversionMatches(value.source, value.target, value)
      ? { category: "checked-range", lowering: "exact-integer", sourceMode: "value",
          source: value.source, target: value.target, fallible: true }
      : undefined;
  }
  if (value.kind === "native-representation") {
    return isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
      !rustTargetTypeRefEquals(value.source, value.target) && rustNativeRepresentationMatches(value.source, value.target)
      ? { category: "exact", lowering: "identity", sourceMode: "value", source: value.source, target: value.target, fallible: false }
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
    if (rustTargetTypeRefEquals(value.source, rustEmptyObjectTargetType()) || rustJsRecordValueAdmission(value.source)) {
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
          sourceMode: "value",
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
          sourceMode: "value",
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
          sourceFallible: value.sourceFallible,
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
    return isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.element) &&
      (!isRustAbsenceCarrier(value.source) || rustTargetTypeRefEquals(value.source, value.element)) &&
      rustNativeRepresentationMatches(value.source, value.element)
      ? {
          category: "exact",
          lowering: "option-some",
          sourceMode: "value",
          source: value.source,
          target: rustOptionTargetType(value.element),
          fallible: false,
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
          fallible: element.fallible,
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
    const path = isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target)
      ? rustUnionInjectionPath(value.source, value.target, definitions) : undefined;
    return hasExactObjectKeys(value, ["kind", "source", "target", "variantName"]) &&
        isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
        path !== undefined && path[0]!.variant.name === value.variantName
      ? {
          category: "exact",
          lowering: "source-union-variant",
          sourceMode: "value",
          source: value.source,
          target: value.target,
          variantName: value.variantName,
          path,
          fallible: false,
        }
      : undefined;
  }
  if (value.kind === "union-map") {
    const expected = selectRustUnionArmMapping(value.source, value.target, value.coverage, definitions);
    return expected === undefined || !closedMetadataEquals(expected, value.arms) ? undefined : {
      category: "exact", lowering: "union-map", sourceMode: "value", source: value.source,
      target: value.target, coverage: value.coverage, arms: expected, fallible: false,
    };
  }
  if (value.kind === "union-project") {
    return rustUnionProjectionContract(value.source, value.target, definitions) === undefined ? undefined : {
      category: "projection", lowering: "union-project", sourceMode: "value", source: value.source,
      target: value.target, fallible: false,
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
  const numberBoxingSource = rustNumberBoxingSourceKind(value.id);
  if (numberBoxingSource !== undefined) {
    return contract(value.id, "exact", "js_abi::JsValue::from", "value",
      rustSourcePrimitiveTargetType(numberBoxingSource), jsValueCarrier, false);
  }
  switch (value.id) {
    case "js-numeric-from-number":
      return contract(value.id, "exact", "js_abi::JsNumeric::from_number", "value", float64Carrier, rustJsNumericTargetType(), false);
    case "js-string-number-from-string":
      return contract(value.id, "exact", "js_abi::JsStringNumber::from_string", "value", stringCarrier, rustJsStringNumberTargetType(), false);
    case "js-string-number-from-number":
      return contract(value.id, "exact", "js_abi::JsStringNumber::from_number", "value", float64Carrier, rustJsStringNumberTargetType(), false);
    case "js-string-number-from-int32":
      return contract(value.id, "exact", "js_abi::JsStringNumber::from_int32", "value", int32Carrier, rustJsStringNumberTargetType(), false);
    case "js-numeric-from-int32":
      return contract(value.id, "exact", "js_abi::JsNumeric::from_int32", "value", int32Carrier, rustJsNumericTargetType(), false);
    case "js-numeric-from-bigint":
      return contract(value.id, "exact", "js_abi::JsNumeric::from_bigint", "ref", rustBigIntTargetType(), rustJsNumericTargetType(), false);
    case "checked-i32-to-usize":
      return contract(value.id, "checked-range", "rt::conversions::i32_to_usize", "value", int32Carrier, usizeCarrier, true);
    case "checked-i32-to-u8":
      return contract(value.id, "checked-range", "rt::conversions::i32_to_u8", "value", int32Carrier, uint8Carrier, true);
    case "checked-f64-to-u8-trunc":
      return contract(value.id, "checked-range", "rt::conversions::f64_to_u8", "value", float64Carrier, uint8Carrier, true);
    case "checked-usize-to-i32":
      return contract(value.id, "checked-range", "rt::conversions::usize_to_i32", "value", usizeCarrier, int32Carrier, true);
    case "checked-isize-to-i32":
      return contract(value.id, "checked-range", "rt::conversions::isize_to_i32", "value", isizeCarrier, int32Carrier, true);
    case "checked-u32-to-i32":
      return contract(value.id, "checked-range", "rt::conversions::u32_to_i32", "value", uint32Carrier, int32Carrier, true);
    case "exact-u8-to-i32":
      return contract(value.id, "exact", "rt::conversions::u8_to_i32", "value", uint8Carrier, int32Carrier, false);
    case "exact-i32-to-f64":
      return contract(value.id, "exact", "rt::conversions::i32_to_f64", "value", int32Carrier, float64Carrier, false);
    case "checked-f64-to-i32-trunc":
      return contract(value.id, "checked-range", "rt::conversions::f64_to_i32", "value", float64Carrier, int32Carrier, true);
    case "js-number-from-isize":
      return contract(value.id, "js-number", "rt::conversions::isize_to_f64", "value", isizeCarrier, float64Carrier, false);
    case "js-number-from-usize":
      return contract(value.id, "js-number", "rt::conversions::usize_to_f64", "value", usizeCarrier, float64Carrier, false);
    case "js-number-from-u64":
      return contract(value.id, "js-number", "rt::conversions::u64_to_f64", "value", uint64Carrier, float64Carrier, false);
    case "js-value-from-bool":
      return contract(value.id, "exact", "js_abi::JsValue::from", "value", boolCarrier, jsValueCarrier, false);
    case "js-value-from-absence":
      return contract(value.id, "exact", "js_abi::JsValue::from", "value", absenceCarrier, jsValueCarrier, false);
    case "js-value-from-string":
      return contract(value.id, "exact", "js_abi::JsValue::from", "value", stringCarrier, jsValueCarrier, false);
    case "js-value-from-symbol":
      return contract(value.id, "exact", "js_abi::JsValue::from", "value", symbolCarrier, jsValueCarrier, false);
    case "js-value-from-error":
      return contract(value.id, "exact", "js_abi::JsValue::from_error", "ref", rustJsErrorTargetType(), jsValueCarrier, false);
    case "js-value-clone":
      return contract(value.id, "exact", "js_abi::clone_js_value", "ref", jsValueCarrier, jsValueCarrier, false);
    case "ts-value-clone":
      return contract(value.id, "exact", "rt::clone_ts_value", "ref", tsValueCarrier, tsValueCarrier, false);
    case "owned-string-from-borrowed-str":
      return {
        category: "ownership",
        lowering: "owned-string-from-borrowed-str",
        sourceMode: "value",
        source: rustBorrowedStrTargetType(),
        target: stringCarrier,
        fallible: false,
      };
    case "borrowed-str-from-owned-string":
      return {
        category: "ownership",
        lowering: "borrowed-str-from-owned-string",
        sourceMode: "ref",
        source: stringCarrier,
        target: { kind: "reference", referent: rustStrTargetType(), mutable: false },
        fallible: false,
      };
    case "borrowed-str-from-optional-string":
      return {
        category: "ownership",
        lowering: "borrowed-str-from-optional-string",
        sourceMode: "ref",
        source: rustSourceOptionalTargetType(stringCarrier),
        target: rustBorrowedStrTargetType(),
        fallible: false,
      };
  }
  return undefined;
}

function contract(
  _id: RustValueConversionId,
  category: RustValueConversionContract["category"],
  path: string,
  sourceMode: RustValueConversionContract["sourceMode"],
  source: TargetTypeRef,
  target: TargetTypeRef,
  fallible: boolean,
): RustValueConversionContract {
  return { category, lowering: "call", path, sourceMode, source, target, fallible };
}

export function rustValueConversionIsFallible(value: RustValueConversion | undefined, definitions: RustTypeDefinitions = emptyRustTypeDefinitions): boolean {
  return value !== undefined && rustValueConversionContract(value, definitions)?.fallible === true;
}

export function rustValueConversionIdentity(value: RustValueConversion): string {
  if (value.kind === "exact-integer") {
    return `exact-integer.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}`;
  }
  if (value.kind === "native-representation") {
    return `native-representation.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}`;
  }
  if (value.kind === "native-upcast") {
    return `native-upcast.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}.${value.path}`;
  }
  if (value.kind === "rest-sequence") {
    return `rest-sequence.${JSON.stringify(value.source)}.${JSON.stringify(value.elementTarget)}.${value.elementConversions.map(conversion => conversion === null ? "identity" : rustValueConversionIdentity(conversion)).join("|")}`;
  }
  if (value.kind === "union-map" || value.kind === "union-project") return `${value.kind}.${JSON.stringify(value)}`;
  return value.kind === "semantic-conversion"
    ? value.id
    : value.kind === "numeric-promotion" || value.kind === "integer-refinement"
      ? `${value.kind}.${value.source}.${value.target}`
      : value.kind === "raw-pointer-mut-to-const"
        ? `raw-pointer-mut-to-const.${JSON.stringify(value.pointee)}`
        : value.kind === "copy-from-reference"
          ? `copy-from-reference.${JSON.stringify(value.target)}`
        : value.kind === "source-union-variant"
          ? `source-union-variant.${value.variantName}.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}`
          : value.kind === "bottom-coercion"
            ? `bottom-coercion.${JSON.stringify(value.target)}`
            : value.kind === "js-argument-vector-callback"
              ? `js-argument-vector-callback.${value.lane}.${value.sourceFallible}.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}.${value.projections.join(".")}`
            : value.kind === "closed-value-from-option"
              ? `closed-value-from-option.${JSON.stringify(value.source)}.${rustValueConversionIdentity(value.elementConversion)}`
            : value.kind === "js-value-from-array"
              ? `js-value-from-array.${JSON.stringify(value.source)}.${rustValueConversionIdentity(value.elementConversion)}`
            : value.kind === "js-array-backing"
              ? `js-array-backing.${JSON.stringify(value.source)}.${JSON.stringify(value.element)}`
            : value.kind === "js-value-from-closed-carrier"
              ? `js-value-from-closed-carrier.${JSON.stringify(value.source)}`
            : value.kind === "ts-value-from-closed-carrier"
              ? `ts-value-from-closed-carrier.${JSON.stringify(value.source)}`
            : value.kind === "union-fold"
              ? `union-fold.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}.${value.arms.map(arm => `${JSON.stringify({ carrier: arm.carrier, path: arm.path })}:${rustValueConversionIdentity(arm.conversion)}`).join("|")}`
            : value.kind === "js-value-from-structural-to-json"
              ? `js-value-from-structural-to-json.${JSON.stringify(value.source)}.${value.storageIndex}.${value.passesPropertyKey}.${rustValueConversionIdentity(value.resultConversion)}`
            : value.kind === "js-value-from-structural-object"
              ? `js-value-from-structural-object.${JSON.stringify(value.source)}.${value.fields.map((field) => `${field.sourceName}:${rustValueConversionIdentity(field.conversion)}`).join("|")}`
            : value.kind === "option-some"
              ? `${value.kind}.${JSON.stringify(value.source)}.${JSON.stringify(value.element)}`
            : value.kind === "source-optional"
              ? `${value.kind}.${JSON.stringify(value.element)}`
            : `option-map.${rustValueConversionIdentity(value.elementConversion)}`;
}


function callbackProtocol(
  carrier: TargetTypeRef,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  if (carrier.kind === "closure" || carrier.kind === "function-pointer") {
    return { parameters: carrier.args, result: carrier.result };
  }
  return rustCallableProtocol(carrier);
}
