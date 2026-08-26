import {
  rustBigIntTargetId,
  rustJsArrayConcatItemTargetId,
  rustJsArrayTargetId,
  rustJsDateTargetId,
  rustJsErrorTargetId,
  rustJsMapTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpIndicesTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
  rustJsRegExpTargetId,
  rustJsSetTargetId,
  rustJsStringTargetId,
  rustJsValueTargetId,
  rustNullTargetId,
  rustProgramErrorTargetId,
  rustRegExpExecArrayTargetId,
  rustRegExpIndicesTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
  rustStringTargetId,
  rustUndefinedTargetId,
} from "./source-types.js";
import {
  rustBuiltinPathTargetType,
  rustBuiltinPathTypeMatches,
  rustBuiltinTypeIdentityItemId,
  rustPathTypeArguments,
} from "../constructors.js";
import { rustOptionTargetType } from "./optional.js";
import type { TargetTypeRef } from "../model.js";

const runtimePathById: Readonly<Record<string, string>> = Object.freeze({
  [rustJsValueTargetId]: "js_abi::JsValue",
  [rustJsStringTargetId]: "js_abi::JsString",
  [rustJsErrorTargetId]: "rt::JsError",
  [rustProgramErrorTargetId]: "rt::TsonicError",
  [rustJsArrayTargetId]: "js_abi::JsArray",
  [rustJsArrayConcatItemTargetId]: "js_abi::JsArrayConcatItem",
  [rustJsMapTargetId]: "js_abi::JsMap",
  [rustJsSetTargetId]: "js_abi::JsSet",
  [rustJsDateTargetId]: "js_abi::JsDate",
  [rustJsRegExpTargetId]: "js_abi::JsRegExp",
  [rustRegExpExecArrayTargetId]: "js_abi::RegExpExecArray",
  [rustRegExpMatchArrayTargetId]: "js_abi::RegExpMatchArray",
  [rustRegExpIndicesTargetId]: "js_abi::RegExpIndices",
  [rustRegExpNamedGroupsTargetId]: "js_abi::RegExpNamedGroups",
  [rustRegExpNamedIndicesTargetId]: "js_abi::RegExpNamedIndices",
  [rustRegExpStringIteratorTargetId]: "js_abi::RegExpStringIterator",
  [rustJsRegExpExecArrayTargetId]: "js_abi::JsRegExpExecArray",
  [rustJsRegExpMatchArrayTargetId]: "js_abi::JsRegExpMatchArray",
  [rustJsRegExpIndicesTargetId]: "js_abi::JsRegExpIndices",
  [rustJsRegExpNamedGroupsTargetId]: "js_abi::JsRegExpNamedGroups",
  [rustJsRegExpNamedIndicesTargetId]: "js_abi::JsRegExpNamedIndices",
  [rustJsRegExpStringIteratorTargetId]: "js_abi::JsRegExpStringIterator",
});

function runtimeTargetType(
  id: string,
  typeArguments: readonly TargetTypeRef[] = [],
): TargetTypeRef {
  const path = runtimePathById[id];
  if (path === undefined) {
    throw new Error(`Missing exact Rust runtime path for '${id}'.`);
  }
  return rustBuiltinPathTargetType(id, path, typeArguments, "tsonic-runtime");
}

export function rustJsValueTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsValueTargetId);
}

export function rustJsStringTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsStringTargetId);
}

export function rustJsErrorTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsErrorTargetId);
}

export function rustProgramErrorTargetType(): TargetTypeRef {
  return runtimeTargetType(rustProgramErrorTargetId);
}

export function isRustProgramErrorCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustBuiltinPathTypeMatches(carrier, rustProgramErrorTargetId, "tsonic-runtime");
}

export function rustJsArrayTargetType(element: TargetTypeRef): TargetTypeRef {
  return runtimeTargetType(rustJsArrayTargetId, [element]);
}

export function rustJsArrayConcatItemTargetType(element: TargetTypeRef): TargetTypeRef {
  return runtimeTargetType(rustJsArrayConcatItemTargetId, [element]);
}

export function rustJsMapTargetType(key: TargetTypeRef, value: TargetTypeRef): TargetTypeRef {
  return runtimeTargetType(rustJsMapTargetId, [key, value]);
}

export function rustJsSetTargetType(value: TargetTypeRef): TargetTypeRef {
  return runtimeTargetType(rustJsSetTargetId, [value]);
}

export function getRustJsMapTargetTypes(
  carrier: TargetTypeRef | undefined,
): { readonly key: TargetTypeRef; readonly value: TargetTypeRef } | undefined {
  const argumentsList = rustBuiltinPathTypeMatches(carrier, rustJsMapTargetId, "tsonic-runtime")
    ? rustPathTypeArguments(carrier)
    : undefined;
  const [key, value] = argumentsList ?? [];
  return argumentsList?.length === 2 && key !== undefined && value !== undefined
    ? { key, value }
    : undefined;
}

export function getRustJsSetElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const argumentsList = rustBuiltinPathTypeMatches(carrier, rustJsSetTargetId, "tsonic-runtime")
    ? rustPathTypeArguments(carrier)
    : undefined;
  return argumentsList?.length === 1 ? argumentsList[0] : undefined;
}

export function rustJsDateTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsDateTargetId);
}

export function rustJsRegExpTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsRegExpTargetId);
}

export function rustRegExpExecArrayTargetType(): TargetTypeRef {
  return runtimeTargetType(rustRegExpExecArrayTargetId);
}

export function rustRegExpMatchArrayTargetType(): TargetTypeRef {
  return runtimeTargetType(rustRegExpMatchArrayTargetId);
}

export function rustRegExpIndicesTargetType(): TargetTypeRef {
  return runtimeTargetType(rustRegExpIndicesTargetId);
}

export function rustRegExpNamedGroupsTargetType(): TargetTypeRef {
  return runtimeTargetType(rustRegExpNamedGroupsTargetId);
}

export function rustRegExpNamedIndicesTargetType(): TargetTypeRef {
  return runtimeTargetType(rustRegExpNamedIndicesTargetId);
}

export function rustRegExpStringIteratorTargetType(): TargetTypeRef {
  return runtimeTargetType(rustRegExpStringIteratorTargetId);
}

export function rustJsRegExpExecArrayTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsRegExpExecArrayTargetId);
}

export function rustJsRegExpMatchArrayTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsRegExpMatchArrayTargetId);
}

export function rustJsRegExpIndicesTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsRegExpIndicesTargetId);
}

export function rustJsRegExpNamedGroupsTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsRegExpNamedGroupsTargetId);
}

export function rustJsRegExpNamedIndicesTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsRegExpNamedIndicesTargetId);
}

export function rustJsRegExpStringIteratorTargetType(): TargetTypeRef {
  return runtimeTargetType(rustJsRegExpStringIteratorTargetId);
}

export function isRustVecCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is Extract<TargetTypeRef, { readonly kind: "sequence" }> {
  return carrier?.kind === "sequence";
}

export function isRustJsArrayCarrier(
  carrier: TargetTypeRef | undefined,
): carrier is Extract<TargetTypeRef, { readonly kind: "path" }> {
  return rustBuiltinPathTypeMatches(carrier, rustJsArrayTargetId, "tsonic-runtime");
}

export function rustJsArrayLikeElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const id = rustBuiltinTypeIdentityItemId(carrier, "tsonic-runtime");
  if (id === rustJsArrayTargetId) {
    const argumentsList = rustPathTypeArguments(carrier);
    return argumentsList?.length === 1 ? argumentsList[0] : undefined;
  }
  if (id === rustRegExpExecArrayTargetId || id === rustRegExpMatchArrayTargetId) {
    return rustBuiltinPathTargetType(rustStringTargetId, "String");
  }
  if (id === rustJsRegExpExecArrayTargetId || id === rustJsRegExpMatchArrayTargetId) {
    return rustJsStringTargetType();
  }
  return id === rustRegExpIndicesTargetId || id === rustJsRegExpIndicesTargetId
    ? {
        kind: "tuple",
        elements: Object.freeze([
          { kind: "source-primitive", name: "float64" },
          { kind: "source-primitive", name: "float64" },
        ]),
      }
    : undefined;
}

export function rustJsArrayLikeIterationElementTargetType(
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const element = rustJsArrayLikeElementTargetType(carrier);
  const id = rustBuiltinTypeIdentityItemId(carrier, "tsonic-runtime");
  if (element === undefined || id === undefined) return undefined;
  return rustRegExpResultArrayTargetIds.has(id) ? rustOptionTargetType(element) : element;
}

const rustRegExpResultArrayTargetIds: ReadonlySet<string> = new Set([
  rustRegExpExecArrayTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpIndicesTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpIndicesTargetId,
]);

export function isRustJsArrayLikeCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustJsArrayLikeElementTargetType(carrier) !== undefined;
}

export function isRustJsValueCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustBuiltinPathTypeMatches(carrier, rustJsValueTargetId, "tsonic-runtime");
}

export function isRustStringCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustBuiltinPathTypeMatches(carrier, rustStringTargetId, "rust");
}

export function isRustJsStringCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustBuiltinPathTypeMatches(carrier, rustJsStringTargetId, "tsonic-runtime");
}

export function isRustBigIntCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustBuiltinPathTypeMatches(carrier, rustBigIntTargetId, "tsonic-runtime");
}

export function isRustUnitCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "unit";
}

export function isRustNeverCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "never";
}

export function isRustUndefinedCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustBuiltinPathTypeMatches(carrier, rustUndefinedTargetId, "tsonic-runtime");
}

export function isRustNullCarrier(carrier: TargetTypeRef | undefined): boolean {
  return rustBuiltinPathTypeMatches(carrier, rustNullTargetId, "tsonic-runtime");
}

export function isRustBoolCarrier(carrier: TargetTypeRef | undefined): boolean {
  return carrier?.kind === "source-primitive" && carrier.name === "bool";
}
