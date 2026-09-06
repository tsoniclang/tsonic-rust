import {
  hasExactObjectKeys,
  isDenseDataArray,
} from "../../metadata/closed-data.js";
import { isRustTargetTypeRef } from "../equality.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../model.js";
import {
  isRustLifetimeRef,
} from "../../lifetimes/index.js";

export const rustStringTargetId = "rust.std.String";
export const rustStrTargetId = "rust.primitive.str";
export const rustNativeScalarTargetId = "rust.native.char";
export const rustJsStringTargetId = "rust.js.JsString";
export const rustBigIntTargetId = "rust.runtime.BigInt";
export const rustOptionTargetId = "rust.std.Option";
export const rustLocationTargetId = "rust.runtime.Location";
export const rustRawPointerTargetId = "rust.runtime.RawPointer";
export const rustCallableTargetId = "rust.runtime.Callable";
export const rustGeneratorTargetId = "rust.runtime.Generator";
export const rustAsyncGeneratorTargetId = "rust.runtime.AsyncGenerator";
export const rustBorrowedGeneratorTargetId = "rust.runtime.BorrowedGenerator";
export const rustBorrowedAsyncGeneratorTargetId = "rust.runtime.BorrowedAsyncGenerator";
export const rustIteratorResultTargetId = "rust.runtime.IteratorResult";
export const rustNullTargetId = "rust.runtime.Null";
export const rustUndefinedTargetId = "rust.runtime.Undefined";
export const rustJsErrorTargetId = "rust.runtime.JsError";
export const rustProgramErrorTargetId = "rust.program.TsonicError";
export const rustTsValueTargetId = "rust.runtime.TsValue";
export const rustJsValueTargetId = "rust.js.JsValue";
export const rustJsArrayTargetId = "rust.js.JsArray";
export const rustJsArrayConcatItemTargetId = "rust.js.JsArrayConcatItem";
export const rustJsMapTargetId = "rust.js.JsMap";
export const rustJsSetTargetId = "rust.js.JsSet";
export const rustJsDateTargetId = "rust.js.JsDate";
export const rustJsSymbolTargetId = "rust.js.JsSymbol";
export const rustJsWeakMapTargetId = "rust.js.JsWeakMap";
export const rustJsWeakSetTargetId = "rust.js.JsWeakSet";
export const rustJsPromiseTargetId = "rust.js.JsPromise";
export const rustJsPromiseFulfilledResultTargetId = "rust.js.PromiseFulfilledResult";
export const rustJsPromiseRejectedResultTargetId = "rust.js.PromiseRejectedResult";
export const rustJsPromiseSettledResultTargetId = "rust.js.PromiseSettledResult";
export const rustJsArrayBufferTargetId = "rust.js.ArrayBuffer";
export const rustJsDataViewTargetId = "rust.js.DataView";
export const rustJsInt8ArrayTargetId = "rust.js.Int8Array";
export const rustJsUint8ArrayTargetId = "rust.js.Uint8Array";
export const rustJsUint8ClampedArrayTargetId = "rust.js.Uint8ClampedArray";
export const rustJsInt16ArrayTargetId = "rust.js.Int16Array";
export const rustJsUint16ArrayTargetId = "rust.js.Uint16Array";
export const rustJsInt32ArrayTargetId = "rust.js.Int32Array";
export const rustJsUint32ArrayTargetId = "rust.js.Uint32Array";
export const rustJsFloat32ArrayTargetId = "rust.js.Float32Array";
export const rustJsFloat64ArrayTargetId = "rust.js.Float64Array";
export const rustJsIntlDateTimeFormatTargetId = "rust.js.IntlDateTimeFormat";
export const rustJsIntlNumberFormatTargetId = "rust.js.IntlNumberFormat";
export const rustJsIntlCollatorTargetId = "rust.js.IntlCollator";
export const rustJsIntlDateTimeFormatPartTargetId = "rust.js.IntlDateTimeFormatPart";
export const rustJsIntlNumberFormatPartTargetId = "rust.js.IntlNumberFormatPart";
export const rustJsIntlResolvedDateTimeFormatOptionsTargetId = "rust.js.IntlResolvedDateTimeFormatOptions";
export const rustJsIntlResolvedNumberFormatOptionsTargetId = "rust.js.IntlResolvedNumberFormatOptions";
export const rustJsIntlResolvedCollatorOptionsTargetId = "rust.js.IntlResolvedCollatorOptions";
export const rustJsRegExpTargetId = "rust.js.JsRegExp";
export const rustRegExpExecArrayTargetId = "rust.js.RegExpExecArray";
export const rustRegExpMatchArrayTargetId = "rust.js.RegExpMatchArray";
export const rustRegExpIndicesTargetId = "rust.js.RegExpIndices";
export const rustRegExpNamedGroupsTargetId = "rust.js.RegExpNamedGroups";
export const rustRegExpNamedIndicesTargetId = "rust.js.RegExpNamedIndices";
export const rustRegExpStringIteratorTargetId = "rust.js.RegExpStringIterator";
export const rustJsRegExpExecArrayTargetId = "rust.js.JsRegExpExecArray";
export const rustJsRegExpMatchArrayTargetId = "rust.js.JsRegExpMatchArray";
export const rustJsRegExpIndicesTargetId = "rust.js.JsRegExpIndices";
export const rustJsRegExpNamedGroupsTargetId = "rust.js.JsRegExpNamedGroups";
export const rustJsRegExpNamedIndicesTargetId = "rust.js.JsRegExpNamedIndices";
export const rustJsRegExpStringIteratorTargetId = "rust.js.JsRegExpStringIterator";
export const rustNamedTypeCarrierName = "named-type";
export const rustStructuralObjectCarrierName = "structural-object";
export const rustSourceUnionCarrierName = "source-union";
export const rustNeverCarrierName = "never";

export interface RustSourceTypeCarrierValue {
  readonly fileName: string;
  readonly typeName: string;
  readonly shape: "object" | "enum";
  readonly genericArguments: readonly RustTargetGenericArgument[];
}

const noRustSourceTypeGenericArguments: readonly RustTargetGenericArgument[] = Object.freeze([]);

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
  genericArguments: readonly RustTargetGenericArgument[] = noRustSourceTypeGenericArguments,
): TargetTypeRef {
  return {
    kind: "target-specific",
    target: "rust",
    name: "source-type",
    value: {
      fileName,
      typeName,
      shape,
      genericArguments,
    },
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
  if (keys.length !== 4 || keys[0] !== "fileName" ||
    keys[1] !== "genericArguments" || keys[2] !== "shape" ||
    keys[3] !== "typeName") {
    return undefined;
  }
  const candidate = value as {
    readonly fileName?: unknown;
    readonly typeName?: unknown;
    readonly shape?: unknown;
    readonly genericArguments?: unknown;
  };
  return typeof candidate.fileName === "string" && candidate.fileName.length > 0 &&
    typeof candidate.typeName === "string" && candidate.typeName.length > 0 &&
    (candidate.shape === "object" || candidate.shape === "enum") &&
    isDenseDataArray(candidate.genericArguments) &&
    candidate.genericArguments.every(isRustSourceTypeGenericArgument)
    ? {
        fileName: candidate.fileName,
        typeName: candidate.typeName,
        shape: candidate.shape,
        genericArguments: candidate.genericArguments as readonly RustTargetGenericArgument[],
      }
    : undefined;
}

function isRustSourceTypeGenericArgument(value: unknown): value is RustTargetGenericArgument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<RustTargetGenericArgument>;
  const keys = Object.keys(value).sort();
  if (candidate.kind === "lifetime") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "lifetime" &&
      isRustLifetimeRef(candidate.lifetime);
  }
  if (candidate.kind === "type") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "type" &&
      isRustTargetTypeRef(candidate.type);
  }
  return candidate.kind === "const" && keys.length === 2 && keys[0] === "kind" &&
    keys[1] === "value" && isRustSourceTypeConstArgument(candidate.value);
}

function isRustSourceTypeConstArgument(value: unknown): value is RustTargetConstArgument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<RustTargetConstArgument>;
  const keys = Object.keys(value).sort();
  if (candidate.kind === "infer") return keys.length === 1 && keys[0] === "kind";
  if (candidate.kind === "boolean") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "value" &&
      typeof candidate.value === "boolean";
  }
  if (candidate.kind === "integer") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "value" &&
      typeof candidate.value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(candidate.value);
  }
  if (candidate.kind === "char") {
    return keys.length === 2 && keys[0] === "kind" && keys[1] === "value" &&
      typeof candidate.value === "string" && [...candidate.value].length === 1;
  }
  return candidate.kind === "parameter" && keys.length === 3 &&
    keys[0] === "identity" && keys[1] === "kind" && keys[2] === "name" &&
    typeof candidate.identity === "string" && candidate.identity.length > 0 &&
    typeof candidate.name === "string" && candidate.name.length > 0;
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
