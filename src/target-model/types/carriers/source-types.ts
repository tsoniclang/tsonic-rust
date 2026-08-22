import { hasExactObjectKeys } from "./primitives.js";
import { isDenseDataArray } from "../../metadata/closed-data.js";
import { isRustTargetTypeRef } from "../equality.js";
import type { TargetTypeRef } from "../model.js";

export const rustStringTargetId = "rust.std.String";
export const rustBigIntTargetId = "rust.runtime.BigInt";
export const rustOptionTargetId = "rust.std.Option";
export const rustLocationTargetId = "rust.runtime.Location";
export const rustCallableTargetId = "rust.runtime.Callable";
export const rustGeneratorTargetId = "rust.runtime.Generator";
export const rustAsyncGeneratorTargetId = "rust.runtime.AsyncGenerator";
export const rustIteratorResultTargetId = "rust.runtime.IteratorResult";
export const rustNullTargetId = "rust.runtime.Null";
export const rustUndefinedTargetId = "rust.runtime.Undefined";
export const rustJsErrorTargetId = "rust.runtime.JsError";
export const rustProgramErrorTargetId = "rust.program.TsonicError";
export const rustJsValueTargetId = "rust.js.JsValue";
export const rustJsArrayTargetId = "rust.js.JsArray";
export const rustJsArrayConcatItemTargetId = "rust.js.JsArrayConcatItem";
export const rustJsMapTargetId = "rust.js.JsMap";
export const rustJsSetTargetId = "rust.js.JsSet";
export const rustJsDateTargetId = "rust.js.JsDate";
export const rustJsRegExpTargetId = "rust.js.JsRegExp";
export const rustJsRegExpMatchTargetId = "rust.js.JsRegExpMatch";
export const rustNamedTypeCarrierName = "named-type";
export const rustStructuralObjectCarrierName = "structural-object";
export const rustSourceUnionCarrierName = "source-union";
export const rustNeverCarrierName = "never";

export interface RustSourceTypeCarrierValue {
  readonly fileName: string;
  readonly typeName: string;
  readonly shape: "object" | "enum";
  readonly typeArguments: readonly TargetTypeRef[];
}

export interface RustStructuralObjectFieldCarrierValue {
  readonly sourceName: string;
  readonly type: TargetTypeRef;
  readonly presence: "required" | "optional";
  readonly readonly: boolean;
  readonly accessor?: {
    readonly getter: true;
    readonly setter: boolean;
  };
  readonly method?: true;
}

export interface RustStructuralObjectCarrierValue {
  readonly ownerFileName: string;
  readonly fields: readonly RustStructuralObjectFieldCarrierValue[];
}

export interface RustSourceUnionVariantCarrierValue {
  readonly name: string;
  readonly carrier: TargetTypeRef;
}

export interface RustSourceUnionCarrierValue {
  readonly fileName: string;
  readonly typeName: string;
  readonly variants: readonly RustSourceUnionVariantCarrierValue[];
}

export function rustSourceTypeCarrier(
  fileName: string,
  typeName: string,
  shape: "object" | "enum",
  typeArguments: readonly TargetTypeRef[] = [],
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: "source-type",
    value: { fileName, typeName, shape, typeArguments },
  };
}
export function rustSourceTypeCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustSourceTypeCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "source-type") {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys[0] !== "fileName" || keys[1] !== "shape" ||
    keys[2] !== "typeArguments" || keys[3] !== "typeName") {
    return undefined;
  }
  const candidate = value as {
    readonly fileName?: unknown;
    readonly typeName?: unknown;
    readonly shape?: unknown;
    readonly typeArguments?: unknown;
  };
  return typeof candidate.fileName === "string" && candidate.fileName.length > 0 &&
    typeof candidate.typeName === "string" && candidate.typeName.length > 0 &&
    (candidate.shape === "object" || candidate.shape === "enum") &&
    isDenseDataArray(candidate.typeArguments) &&
    candidate.typeArguments.every((argument) => isRustTargetTypeRef(argument))
    ? {
        fileName: candidate.fileName,
        typeName: candidate.typeName,
        shape: candidate.shape,
        typeArguments: candidate.typeArguments as readonly TargetTypeRef[],
      }
    : undefined;
}

export function rustStructuralObjectTargetType(
  ownerFileName: string,
  fields: readonly RustStructuralObjectFieldCarrierValue[],
): TargetTypeRef {
  const canonicalFields = Object.freeze(
    [...fields].sort((left, right) => left.sourceName.localeCompare(right.sourceName)),
  );
  return {
    kind: "target-specific",
    target: "rust",
    name: rustStructuralObjectCarrierName,
    value: { ownerFileName, fields: canonicalFields },
  };
}

export function rustStructuralObjectCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustStructuralObjectCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" ||
    carrier.name !== rustStructuralObjectCarrierName) {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["fields", "ownerFileName"])) {
    return undefined;
  }
  const candidateValue = value as {
    readonly fields?: unknown;
    readonly ownerFileName?: unknown;
  };
  const fields = candidateValue.fields;
  if (typeof candidateValue.ownerFileName !== "string" ||
    candidateValue.ownerFileName.length === 0 ||
    !isDenseDataArray(fields) || fields.length === 0) {
    return undefined;
  }
  const seenNames = new Set<string>();
  const normalized: RustStructuralObjectFieldCarrierValue[] = [];
  for (const field of fields) {
    if (typeof field !== "object" || field === null || Array.isArray(field)) {
      return undefined;
    }
    const candidate = field as Partial<RustStructuralObjectFieldCarrierValue>;
    const expectedKeys = candidate.accessor !== undefined
      ? ["accessor", "presence", "readonly", "sourceName", "type"]
      : candidate.method === true
        ? ["method", "presence", "readonly", "sourceName", "type"]
        : ["presence", "readonly", "sourceName", "type"];
    if (typeof candidate.sourceName !== "string" || candidate.sourceName.length === 0 ||
      seenNames.has(candidate.sourceName) || !isRustTargetTypeRef(candidate.type) ||
      (candidate.presence !== "required" && candidate.presence !== "optional") ||
      typeof candidate.readonly !== "boolean" ||
      !hasExactObjectKeys(field, expectedKeys) ||
      candidate.accessor !== undefined && candidate.method !== undefined ||
      candidate.method !== undefined && candidate.method !== true ||
      candidate.accessor !== undefined && (
        typeof candidate.accessor !== "object" || candidate.accessor === null ||
        Array.isArray(candidate.accessor) ||
        !hasExactObjectKeys(candidate.accessor, ["getter", "setter"]) ||
        candidate.accessor.getter !== true ||
        typeof candidate.accessor.setter !== "boolean"
      )) {
      return undefined;
    }
    seenNames.add(candidate.sourceName);
    normalized.push(candidate as RustStructuralObjectFieldCarrierValue);
  }
  return {
    ownerFileName: candidateValue.ownerFileName,
    fields: Object.freeze(normalized),
  };
}

export function rustSourceUnionTargetType(
  fileName: string,
  typeName: string,
  variants: readonly RustSourceUnionVariantCarrierValue[],
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: rustSourceUnionCarrierName,
    value: { fileName, typeName, variants },
  };
}

export function rustSourceUnionCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustSourceUnionCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" ||
    carrier.name !== rustSourceUnionCarrierName) {
    return undefined;
  }
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["fileName", "typeName", "variants"])) {
    return undefined;
  }
  const candidate = value as Partial<RustSourceUnionCarrierValue>;
  if (typeof candidate.fileName !== "string" || candidate.fileName.length === 0 ||
    typeof candidate.typeName !== "string" || candidate.typeName.length === 0 ||
    !isDenseDataArray(candidate.variants) || candidate.variants.length < 2) {
    return undefined;
  }
  const seenNames = new Set<string>();
  const variants: RustSourceUnionVariantCarrierValue[] = [];
  for (const variant of candidate.variants) {
    if (typeof variant !== "object" || variant === null || Array.isArray(variant) ||
      !hasExactObjectKeys(variant, ["carrier", "name"])) {
      return undefined;
    }
    const selected = variant as Partial<RustSourceUnionVariantCarrierValue>;
    if (typeof selected.name !== "string" || selected.name.length === 0 ||
      seenNames.has(selected.name) || !isRustTargetTypeRef(selected.carrier)) {
      return undefined;
    }
    seenNames.add(selected.name);
    variants.push(selected as RustSourceUnionVariantCarrierValue);
  }
  return {
    fileName: candidate.fileName,
    typeName: candidate.typeName,
    variants: Object.freeze(variants),
  };
}
