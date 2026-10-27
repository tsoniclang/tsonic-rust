import type { TargetTypeRef } from "../types/model.js";

import { type RustProgramErrorRoute } from "./program-error.js";

import type { RustValueConversion } from "../operations/model.js";

import type { RustPrimitiveTypeName } from "../syntax/tokens.js";

import type { RustUnionMappingEmission, RustUnionProjectionEmission } from "../records/types/union-mappings.js";

import { type RustUnionLeaf, type RustUnionArmMapping, type RustUnionPathStep } from "../types/union-relations.js";

interface RustValueConversionContractBase {
  readonly category: "exact" | "checked-range" | "js-number" | "numeric-promotion" | "native-numeric-cast" | "ownership" | "projection";
  readonly sourceMode: "value" | "ref";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}

export type RustValueConversionEffect =
  | { readonly fallible: false }
  | { readonly fallible: true; readonly errorBoundary: "target-runtime" }
  | { readonly fallible: true; readonly errorBoundary: "provider-native"; readonly errorCarrier: TargetTypeRef };

export type RustValueConversionContract = RustValueConversionContractBase & RustValueConversionEffect & (
  | { readonly lowering: "program-error"; readonly route: RustProgramErrorRoute }
  | { readonly lowering: "program-error-closed-value" }
  | { readonly lowering: "project-closed-value"; readonly ownerPath: "rt::TsValue" | "js_abi::JsValue" }
  | { readonly lowering: "js-array-backing"; readonly element: TargetTypeRef; readonly method: "cast" | "cast_array" }
  | { readonly lowering: "source-optional"; readonly element: TargetTypeRef }
  | { readonly lowering: "union-project"; readonly path: readonly RustUnionPathStep[]; readonly emission: RustUnionProjectionEmission }
  | { readonly lowering: "union-map"; readonly coverage: "source" | "target"; readonly arms: readonly RustUnionArmMapping[]; readonly emission: RustUnionMappingEmission }
  | { readonly lowering: "exact-integer"; readonly targetElement: TargetTypeRef;
      readonly optional: boolean; readonly lift: boolean }
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
      readonly payloadCarrier: TargetTypeRef;
      readonly payloadConversion: RustValueConversionContract | null;
    }
  | {
      readonly lowering: "option-map";
      readonly element: RustValueConversionContract;
    }
  | {
      readonly lowering: "option-some";
      readonly element: RustValueConversionContract | null;
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
      readonly targetResultFallible: boolean;
      readonly invocation: "invoke" | "call";
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
      readonly lowering: "js-value-from-properties";
      readonly fields: readonly {
        readonly sourceName: string;
        readonly sourceCarrier: TargetTypeRef;
        readonly presence: "required" | "optional";
        readonly conversion: RustValueConversionContract;
      }[];
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

export function rustValueConversionIdentity(value: RustValueConversion): string {
  if (value.kind === "callable-input") {
    return `callable-input.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}`;
  }
  if (value.kind === "program-error") return `program-error.${JSON.stringify(value)}`;
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
          ? `source-union-variant.${value.variantName}.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}.${JSON.stringify(value.payloadCarrier)}.${value.payloadConversion === null ? "identity" : rustValueConversionIdentity(value.payloadConversion)}`
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
            : value.kind === "js-value-from-properties"
              ? `js-value-from-properties.${JSON.stringify(value.source)}.${value.fields.map(field => `${field.sourceName}:${field.presence}:${JSON.stringify(field.sourceCarrier)}:${rustValueConversionIdentity(field.conversion)}`).join("|")}`
            : value.kind === "js-value-from-structural-object"
              ? `js-value-from-structural-object.${JSON.stringify(value.source)}.${value.fields.map((field) => `${field.sourceName}:${rustValueConversionIdentity(field.conversion)}`).join("|")}`
            : value.kind === "option-some"
              ? `${value.kind}.${JSON.stringify(value.source)}.${JSON.stringify(value.element)}.${value.elementConversion === null ? "identity" : rustValueConversionIdentity(value.elementConversion)}`
            : value.kind === "source-optional"
              ? `${value.kind}.${JSON.stringify(value.element)}`
            : `option-map.${rustValueConversionIdentity(value.elementConversion)}`;
}
