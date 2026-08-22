import type { TargetTypeRef } from "../types/model.js";
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
  rustNeverTargetType,
  rustOptionTargetType,
  rustJsStringTargetType,
  rustJsRegExpExecArrayTargetType,
  rustJsRegExpMatchArrayTargetType,
  rustJsValueTargetType,
  rustPrimitiveTypeName,
  rustSourceUnionCarrierValue,
  rustSourcePrimitiveTargetType,
  rustBorrowedStrTargetType,
  rustStringTargetType,
  substituteRustTargetTypeParameters,
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
const nativeStringCarrier = rustStringTargetType();
const jsStringCarrier = rustJsStringTargetType();
const jsValueCarrier = rustJsValueTargetType();
const regexpExecArrayCarrier = rustJsRegExpExecArrayTargetType();
const regexpMatchArrayCarrier = rustJsRegExpMatchArrayTargetType();

interface RustValueConversionContractBase {
  readonly category: "exact" | "checked-range" | "js-number" | "numeric-promotion" | "ownership";
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
      readonly lowering: "owned-string-from-borrowed-str";
    }
  | {
      readonly lowering: "copy-from-reference";
    }
  | {
      readonly lowering: "js-argument-vector-callback";
      readonly projections: readonly (
        | "string"
        | "value"
        | "rest-values"
      )[];
    }
);

export function rustValueConversionContract(
  value: RustValueConversion,
): RustValueConversionContract | undefined {
  if (value.kind === "js-argument-vector-callback") {
    const source = callbackProtocol(value.source);
    const target = rustClosureProtocol(value.target);
    const vectorCarrier = rustJsArrayTargetType(jsValueCarrier);
    const projections = value.projections;
    const restIndexes = projections.flatMap((projection, index) =>
      projection === "rest-values" ? [index] : []);
    const projectionsMatch = projections.length === source?.parameters.length &&
      projections.every((projection, index) => {
        const parameter = source?.parameters[index];
        const expected = projection === "string"
          ? jsStringCarrier
          : projection === "value"
            ? jsValueCarrier
            : vectorCarrier;
        return parameter !== undefined &&
          rustTargetTypeRefEquals(parameter, expected);
      });
    return source === undefined || target === undefined ||
        !rustTargetTypeRefEquals(source.result, jsStringCarrier) ||
        target.parameters.length !== 1 ||
        !rustTargetTypeRefEquals(target.parameters[0], vectorCarrier) ||
        !rustTargetTypeRefEquals(target.result, jsStringCarrier) ||
        !projectionsMatch || restIndexes.length > 1 ||
        (restIndexes.length === 1 && restIndexes[0] !== projections.length - 1) ||
        projections.some((projection, index) => projection === "string" && index !== 0)
      ? undefined
      : {
          category: "exact",
          lowering: "js-argument-vector-callback",
          sourceMode: "value",
          source: value.source,
          target: value.target,
          projections,
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
    case "js-value-from-string":
      return contract(value.id, "exact", "tsonic_rust_js::abi::js_value_from_string", "ref", jsStringCarrier, jsValueCarrier, false);
    case "js-value-clone":
      return contract(value.id, "exact", "tsonic_rust_js::abi::clone_js_value", "ref", jsValueCarrier, jsValueCarrier, false);
    case "js-regexp-exec-to-match":
      return contract(value.id, "exact", "tsonic_rust_js::abi::regexp_exec_into_match_array", "value", regexpExecArrayCarrier, regexpMatchArrayCarrier, false);
    case "native-string-from-js-string":
      return contract(value.id, "exact", "tsonic_rust_js::abi::js_string_to_utf8", "ref", jsStringCarrier, nativeStringCarrier, false);
    case "js-string-from-native-string":
      return contract(value.id, "exact", "tsonic_rust_js::abi::js_string_from_utf8", "value", nativeStringCarrier, jsStringCarrier, false);
    case "owned-string-from-borrowed-str":
      return {
        category: "ownership",
        lowering: "owned-string-from-borrowed-str",
        sourceMode: "value",
        source: rustBorrowedStrTargetType(),
        target: nativeStringCarrier,
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
            ? `js-argument-vector-callback.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}.${value.projections.join(".")}`
          : value.kind === "option-some"
            ? `option-some.${JSON.stringify(value.element)}`
            : `option-map.${rustValueConversionIdentity(value.elementConversion)}`;
}

export function substituteRustValueConversion(
  value: RustValueConversion,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustValueConversion {
  switch (value.kind) {
    case "copy-from-reference":
      return Object.freeze({
        ...value,
        target: substituteRustTargetTypeParameters(value.target, substitutions),
      });
    case "raw-pointer-mut-to-const":
      return Object.freeze({
        ...value,
        pointee: substituteRustTargetTypeParameters(value.pointee, substitutions),
      });
    case "source-union-variant":
    case "bottom-coercion":
    case "js-argument-vector-callback":
      return Object.freeze({
        ...value,
        source: substituteRustTargetTypeParameters(value.source, substitutions),
        target: substituteRustTargetTypeParameters(value.target, substitutions),
      });
    case "option-some":
      return Object.freeze({
        ...value,
        element: substituteRustTargetTypeParameters(value.element, substitutions),
      });
    case "option-map":
      return Object.freeze({
        ...value,
        elementConversion: substituteRustValueConversion(
          value.elementConversion,
          substitutions,
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
