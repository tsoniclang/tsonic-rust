import type {
  RustTargetConstArgument,
  TargetTypeRef,
} from "../types/model.js";
import type { RustLifetimeRef } from "../lifetimes/index.js";
import {
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../types/equality.js";
import type {
  RustValueConversion,
  RustValueConversionId,
} from "../operations/model.js";
import {
  isRustNeverCarrier,
  isRustNumericCarrier,
  rustCallableProtocol,
  rustClosureProtocol,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustJsSymbolTargetType,
  rustNeverTargetType,
  rustOptionTargetType,
  rustJsValueTargetType,
  rustOptionElementCarrier,
  rustPrimitiveTypeName,
  rustSourceUnionCarrierValue,
  rustSourcePrimitiveTargetType,
  rustBorrowedStrTargetType,
  rustStringTargetType,
  rustStructuralObjectCarrierValue,
  rustJsArrayLikeElementTargetType,
  isRustJsArrayCarrier,
  rustNullTargetType,
  rustUndefinedTargetType,
  rustTargetGenericReferences,
  rustCarrierSupportsClone,
  rustCarrierCanEnterTsValue,
  rustCarrierSupportsTrait,
  rustJsClosedValueCarrierTraitPath,
  substituteRustTargetGenerics,
  rustTsValueTargetType,
} from "../types/index.js";
import type { RustPrimitiveTypeName } from "../syntax/tokens.js";
import { rustNumericPromotionKind } from "./numeric-promotion.js";

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
const nullCarrier = rustNullTargetType();
const undefinedCarrier = rustUndefinedTargetType();

interface RustValueConversionContractBase {
  readonly category: "exact" | "checked-range" | "js-number" | "numeric-promotion" | "ownership" | "projection";
  readonly sourceMode: "value" | "ref";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly fallible: boolean;
}

export type RustValueConversionContract = RustValueConversionContractBase & (
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
      readonly lowering: "copy-from-reference";
    }
  | {
      readonly lowering: "js-value-from-option";
      readonly element: TargetTypeRef;
      readonly elementConversion: RustValueConversionContract;
    }
  | {
      readonly lowering: "js-value-from-array";
      readonly element: TargetTypeRef;
      readonly elementConversion: RustValueConversionContract;
    }
  | {
      readonly lowering: "js-value-from-source-union";
      readonly variants: readonly {
        readonly name: string;
        readonly carrier: TargetTypeRef;
        readonly conversion: RustValueConversionContract;
      }[];
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
): RustValueConversionContract | undefined {
  if (value.kind === "ts-value-from-closed-carrier") {
    return !rustCarrierCanEnterTsValue(value.source)
      ? undefined
      : {
          category: "projection",
          lowering: "call",
          path: "tsonic_rust_runtime::TsValue::from_closed",
          sourceMode: "ref",
          source: value.source,
          target: tsValueCarrier,
          fallible: false,
        };
  }
  if (value.kind === "js-value-from-closed-carrier") {
    return !rustCarrierSupportsClone(value.source) ||
        !rustCarrierSupportsTrait(value.source, rustJsClosedValueCarrierTraitPath)
      ? undefined
      : {
          category: "projection",
          lowering: "call",
          path: "tsonic_rust_js::abi::js_value_from_closed",
          sourceMode: "ref",
          source: value.source,
          target: jsValueCarrier,
          fallible: false,
        };
  }
  if (value.kind === "js-value-from-option") {
    const elementConversion = rustValueConversionContract(value.elementConversion);
    return !rustTargetTypeRefEquals(value.source, rustOptionTargetType(value.element)) ||
        elementConversion === undefined || elementConversion.fallible ||
        !rustTargetTypeRefEquals(elementConversion.source, value.element) ||
        !rustTargetTypeRefEquals(elementConversion.target, jsValueCarrier)
      ? undefined
      : {
          category: "projection",
          lowering: "js-value-from-option",
          sourceMode: "value",
          source: value.source,
          target: jsValueCarrier,
          element: value.element,
          elementConversion,
          fallible: false,
        };
  }
  if (value.kind === "js-value-from-array") {
    const elementConversion = rustValueConversionContract(value.elementConversion);
    return !isRustJsArrayCarrier(value.source) ||
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
          fallible: false,
        };
  }
  if (value.kind === "js-value-from-source-union") {
    const union = rustSourceUnionCarrierValue(value.source);
    if (union === undefined || union.variants.length !== value.variants.length) {
      return undefined;
    }
    const variants = value.variants.map((variant, index) => {
      const sourceVariant = union.variants[index];
      const conversion = rustValueConversionContract(variant.conversion);
      return sourceVariant === undefined || sourceVariant.name !== variant.name ||
          !rustTargetTypeRefEquals(sourceVariant.carrier, variant.carrier) ||
          conversion === undefined || conversion.fallible ||
          !rustTargetTypeRefEquals(conversion.source, variant.carrier) ||
          !rustTargetTypeRefEquals(conversion.target, jsValueCarrier)
        ? undefined
        : {
            name: variant.name,
            carrier: variant.carrier,
            conversion,
          };
    });
    return variants.some((variant) => variant === undefined)
      ? undefined
      : {
          category: "projection",
          lowering: "js-value-from-source-union",
          sourceMode: "value",
          source: value.source,
          target: jsValueCarrier,
          variants: variants as NonNullable<typeof variants[number]>[],
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
    const resultConversion = rustValueConversionContract(value.resultConversion);
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
      const conversion = rustValueConversionContract(field.conversion);
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
  if (value.kind === "option-some") {
    return isRustTargetTypeRef(value.element)
      ? {
          category: "exact",
          lowering: "option-some",
          sourceMode: "value",
          source: value.element,
          target: rustOptionTargetType(value.element),
          fallible: false,
        }
      : undefined;
  }
  if (value.kind === "option-map") {
    const element = rustValueConversionContract(value.elementConversion);
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
    const union = rustSourceUnionCarrierValue(value.target);
    const matches = union?.variants.filter((variant) =>
      variant.name === value.variantName &&
      rustTargetTypeRefEquals(variant.carrier, value.source)) ?? [];
    return isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
        matches.length === 1
      ? {
          category: "exact",
          lowering: "source-union-variant",
          sourceMode: "value",
          source: value.source,
          target: value.target,
          variantName: value.variantName,
          fallible: false,
        }
      : undefined;
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
  if (value.kind === "numeric-promotion") {
    const source = rustSourcePrimitiveTargetType(value.source);
    const target = rustSourcePrimitiveTargetType(value.target);
    const targetType = rustPrimitiveTypeName(value.target);
    return isRustNumericCarrier(source) && isRustNumericCarrier(target) &&
        rustNumericPromotionKind(value.source, value.target) === value.target &&
        targetType !== undefined
      ? {
          category: "numeric-promotion",
          lowering: "numeric-cast",
          sourceMode: "value",
          source,
          target,
          targetType,
          fallible: false,
        }
      : undefined;
  }
  switch (value.id) {
    case "checked-i32-to-usize":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::i32_to_usize", "value", int32Carrier, usizeCarrier, true);
    case "checked-i32-to-u8":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::i32_to_u8", "value", int32Carrier, uint8Carrier, true);
    case "checked-usize-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::usize_to_i32", "value", usizeCarrier, int32Carrier, true);
    case "checked-isize-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::isize_to_i32", "value", isizeCarrier, int32Carrier, true);
    case "checked-u32-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::u32_to_i32", "value", uint32Carrier, int32Carrier, true);
    case "exact-u8-to-i32":
      return contract(value.id, "exact", "tsonic_rust_runtime::conversions::u8_to_i32", "value", uint8Carrier, int32Carrier, false);
    case "exact-i32-to-f64":
      return contract(value.id, "exact", "tsonic_rust_runtime::conversions::i32_to_f64", "value", int32Carrier, float64Carrier, false);
    case "checked-f64-to-i32-trunc":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::f64_to_i32", "value", float64Carrier, int32Carrier, true);
    case "js-number-from-isize":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::isize_to_f64", "value", isizeCarrier, float64Carrier, false);
    case "js-number-from-usize":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::usize_to_f64", "value", usizeCarrier, float64Carrier, false);
    case "js-number-from-u64":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::u64_to_f64", "value", uint64Carrier, float64Carrier, false);
    case "js-value-from-bool":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", boolCarrier, jsValueCarrier, false);
    case "js-value-from-f64":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", float64Carrier, jsValueCarrier, false);
    case "js-value-from-i32":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", int32Carrier, jsValueCarrier, false);
    case "js-value-from-null":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", nullCarrier, jsValueCarrier, false);
    case "js-value-from-string":
      return contract(value.id, "exact", "tsonic_rust_js::abi::js_value_from_string", "ref", stringCarrier, jsValueCarrier, false);
    case "js-value-from-symbol":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", symbolCarrier, jsValueCarrier, false);
    case "js-value-from-undefined":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", undefinedCarrier, jsValueCarrier, false);
    case "js-value-clone":
      return contract(value.id, "exact", "tsonic_rust_js::abi::clone_js_value", "ref", jsValueCarrier, jsValueCarrier, false);
    case "ts-value-clone":
      return contract(value.id, "exact", "tsonic_rust_runtime::clone_ts_value", "ref", tsValueCarrier, tsValueCarrier, false);
    case "owned-string-from-borrowed-str":
      return {
        category: "ownership",
        lowering: "owned-string-from-borrowed-str",
        sourceMode: "value",
        source: rustBorrowedStrTargetType(),
        target: stringCarrier,
        fallible: false,
      };
  }
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

export function rustValueConversionIsFallible(value: RustValueConversion | undefined): boolean {
  return value !== undefined && rustValueConversionContract(value)?.fallible === true;
}

export function rustValueConversionIdentity(value: RustValueConversion): string {
  return value.kind === "semantic-conversion"
    ? value.id
    : value.kind === "numeric-promotion"
      ? `numeric-promotion.${value.source}.${value.target}`
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
            : value.kind === "js-value-from-option"
              ? `js-value-from-option.${JSON.stringify(value.source)}.${rustValueConversionIdentity(value.elementConversion)}`
            : value.kind === "js-value-from-array"
              ? `js-value-from-array.${JSON.stringify(value.source)}.${rustValueConversionIdentity(value.elementConversion)}`
            : value.kind === "js-value-from-closed-carrier"
              ? `js-value-from-closed-carrier.${JSON.stringify(value.source)}`
            : value.kind === "ts-value-from-closed-carrier"
              ? `ts-value-from-closed-carrier.${JSON.stringify(value.source)}`
            : value.kind === "js-value-from-source-union"
              ? `js-value-from-source-union.${JSON.stringify(value.source)}.${value.variants.map((variant) => `${variant.name}:${rustValueConversionIdentity(variant.conversion)}`).join("|")}`
            : value.kind === "js-value-from-structural-to-json"
              ? `js-value-from-structural-to-json.${JSON.stringify(value.source)}.${value.storageIndex}.${value.passesPropertyKey}.${rustValueConversionIdentity(value.resultConversion)}`
            : value.kind === "js-value-from-structural-object"
              ? `js-value-from-structural-object.${JSON.stringify(value.source)}.${value.fields.map((field) => `${field.sourceName}:${rustValueConversionIdentity(field.conversion)}`).join("|")}`
            : value.kind === "option-some"
              ? `option-some.${JSON.stringify(value.element)}`
            : `option-map.${rustValueConversionIdentity(value.elementConversion)}`;
}

export function substituteRustValueConversion(
  value: RustValueConversion,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef> = new Map(),
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument> = new Map(),
): RustValueConversion {
  switch (value.kind) {
    case "copy-from-reference":
      return Object.freeze({
        ...value,
        target: substituteRustTargetGenerics(
          value.target,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "raw-pointer-mut-to-const":
      return Object.freeze({
        ...value,
        pointee: substituteRustTargetGenerics(
          value.pointee,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "source-union-variant":
    case "bottom-coercion":
    case "js-argument-vector-callback":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        target: substituteRustTargetGenerics(
          value.target,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "js-value-from-option":
    case "js-value-from-array":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        element: substituteRustTargetGenerics(
          value.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        elementConversion: substituteRustValueConversion(
          value.elementConversion,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ) as typeof value.elementConversion,
      });
    case "js-value-from-closed-carrier":
    case "ts-value-from-closed-carrier":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "js-value-from-source-union":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        variants: Object.freeze(value.variants.map((variant) => Object.freeze({
          ...variant,
          carrier: substituteRustTargetGenerics(
            variant.carrier,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ),
          conversion: substituteRustValueConversion(
            variant.conversion,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ) as typeof variant.conversion,
        }))),
      });
    case "js-value-from-structural-to-json":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        resultCarrier: substituteRustTargetGenerics(
          value.resultCarrier,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        resultConversion: substituteRustValueConversion(
          value.resultConversion,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ) as typeof value.resultConversion,
      });
    case "js-value-from-structural-object":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        fields: Object.freeze(value.fields.map((field) => Object.freeze({
          ...field,
          sourceCarrier: substituteRustTargetGenerics(
            field.sourceCarrier,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ),
          conversion: substituteRustValueConversion(
            field.conversion,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ) as typeof field.conversion,
        }))),
      });
    case "option-some":
      return Object.freeze({
        ...value,
        element: substituteRustTargetGenerics(
          value.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "option-map":
      return Object.freeze({
        ...value,
        elementConversion: substituteRustValueConversion(
          value.elementConversion,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ) as typeof value.elementConversion,
      });
    case "semantic-conversion":
    case "numeric-promotion":
      return value;
  }
}

function callbackProtocol(
  carrier: TargetTypeRef,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  if (carrier.kind === "closure" || carrier.kind === "function-pointer") {
    return { parameters: carrier.args, result: carrier.result };
  }
  return rustCallableProtocol(carrier);
}
