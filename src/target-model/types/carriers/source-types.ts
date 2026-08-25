import {
  hasExactObjectKeys,
  isDenseDataArray,
} from "../../metadata/closed-data.js";
import { isRustGenericArgumentValue, isRustTargetTypeRef } from "../equality.js";
import type { TargetTypeRef } from "../model.js";
import { rustSourceCarrierTargetType } from "../constructors.js";
import { rustBuiltinIdentity } from "../../semantics/index.js";
import type { RustGenericArgument } from "../../semantics/index.js";

export const rustStringTargetId = "rust.std.String";
export const rustJsStringTargetId = "rust.js.JsString";
export const rustBigIntTargetId = "rust.runtime.BigInt";
export const rustOptionTargetId = "rust.std.Option";
export const rustOwnedLocationTargetId = "rust.runtime.OwnedLocation";
export const rustBorrowedLocationTargetId = "rust.runtime.BorrowedLocation";
export const rustOwnedLocalCallableTargetId = "rust.runtime.OwnedLocalCallable";
export const rustBorrowedLocalCallableTargetId = "rust.runtime.BorrowedLocalCallable";
export const rustThreadedCallableTargetId = "rust.runtime.ThreadedCallable";
export const rustOwnedLocalAsyncCallableTargetId = "rust.runtime.OwnedLocalAsyncCallable";
export const rustBorrowedLocalAsyncCallableTargetId = "rust.runtime.BorrowedLocalAsyncCallable";
export const rustThreadedAsyncCallableTargetId = "rust.runtime.ThreadedAsyncCallable";
export const rustOwnedGeneratorTargetId = "rust.runtime.OwnedGenerator";
export const rustBorrowedGeneratorTargetId = "rust.runtime.BorrowedGenerator";
export const rustOwnedAsyncGeneratorTargetId = "rust.runtime.OwnedAsyncGenerator";
export const rustBorrowedAsyncGeneratorTargetId = "rust.runtime.BorrowedAsyncGenerator";
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
  readonly genericArguments: readonly RustGenericArgument[];
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
  genericArguments: readonly RustGenericArgument[] = [],
): TargetTypeRef {
  return rustSourceCarrierTargetType(
    rustBuiltinIdentity("source-type", "tsonic-runtime"),
    Object.freeze({
      fileName,
      typeName,
      shape,
      genericArguments: Object.freeze([...genericArguments]),
    }),
  );
}
export function rustSourceTypeCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustSourceTypeCarrierValue | undefined {
  if (!isSourceCarrierKind(carrier, "source-type")) {
    return undefined;
  }
  const value = carrier.payload;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys[0] !== "fileName" || keys[1] !== "genericArguments" ||
    keys[2] !== "shape" || keys[3] !== "typeName") {
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
    candidate.genericArguments.every((argument) => isRustGenericArgumentValue(argument))
    ? {
        fileName: candidate.fileName,
        typeName: candidate.typeName,
        shape: candidate.shape,
        genericArguments: candidate.genericArguments as readonly RustGenericArgument[],
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
  return rustSourceCarrierTargetType(
    rustBuiltinIdentity(rustStructuralObjectCarrierName, "tsonic-runtime"),
    Object.freeze({ ownerFileName, fields: canonicalFields }),
  );
}

export function rustStructuralObjectCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustStructuralObjectCarrierValue | undefined {
  if (!isSourceCarrierKind(carrier, rustStructuralObjectCarrierName)) {
    return undefined;
  }
  const value = carrier.payload;
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
  return rustSourceCarrierTargetType(
    rustBuiltinIdentity(rustSourceUnionCarrierName, "tsonic-runtime"),
    Object.freeze({ fileName, typeName, variants: Object.freeze([...variants]) }),
  );
}

export function rustSourceUnionCarrierValue(
  carrier: TargetTypeRef | undefined,
): RustSourceUnionCarrierValue | undefined {
  if (!isSourceCarrierKind(carrier, rustSourceUnionCarrierName)) {
    return undefined;
  }
  const value = carrier.payload;
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

function isSourceCarrierKind(
  carrier: TargetTypeRef | undefined,
  itemId: string,
): carrier is Extract<TargetTypeRef, { readonly kind: "source-carrier" }> {
  return carrier?.kind === "source-carrier" &&
    carrier.identity.kind === "builtin" &&
    carrier.identity.namespace === "tsonic-runtime" &&
    carrier.identity.itemId === itemId;
}
