import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustJsArrayEntriesElementTargetType, rustJsArrayEntryTargetType } from "../../../target-model/types/carriers/array-entries.js";
import { isRustStringCarrier, rustFixedArrayCarrierValue, getRustGeneratorProtocol, rustStringTargetType, rustJsArrayLikeElementTargetType, rustJsRegExpExecArrayTargetType, rustJsRegExpStringIteratorTargetId, rustRegExpExecArrayTargetType, rustRegExpStringIteratorTargetId, getRustJsMapTargetTypes, getRustJsSetElementTargetType } from "../../../target-model/types/index.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../constraints/native-traits.js";

type RustIterableTargetPolicy =
  | {
      readonly kind: "borrowed";
      readonly elementCarrier: TargetTypeRef;
      readonly input: "direct" | "reference";
    }
  | {
      readonly kind: "js-array" | "sync-generator" | "async-generator" | "fallible-owned";
      readonly elementCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "receiver-method";
      readonly elementCarrier: TargetTypeRef;
      readonly method: string;
    }
  | {
      readonly kind: "owned-call";
      readonly elementCarrier: TargetTypeRef;
      readonly path: string;
    };

export function rustIterableTargetPolicy(iterable: TargetTypeRef | undefined, definitions: RustTypeDefinitions): RustIterableTargetPolicy | undefined {
  const entryElement = rustJsArrayEntriesElementTargetType(iterable);
  if (entryElement !== undefined) {
    return {
      kind: "receiver-method",
      elementCarrier: rustJsArrayEntryTargetType(entryElement),
      method: "clone",
    };
  }
  if (isRustStringCarrier(iterable)) {
    return {
      kind: "owned-call",
      elementCarrier: rustStringTargetType(),
      path: "js_abi::NativeStringIterator::new",
    };
  }
  if (iterable?.kind === "array") {
    return { kind: "borrowed", elementCarrier: iterable.element, input: "reference" };
  }
  if (iterable?.kind === "reference" && iterable.referent.kind === "slice") {
    return { kind: "borrowed", elementCarrier: iterable.referent.element, input: "direct" };
  }
  const fixed = rustFixedArrayCarrierValue(iterable);
  if (fixed !== undefined) {
    return { kind: "borrowed", elementCarrier: fixed.element, input: "reference" };
  }
  const jsElement = rustJsArrayLikeElementTargetType(iterable);
  if (jsElement !== undefined) {
    return { kind: "js-array", elementCarrier: jsElement };
  }
  const mapTypes = getRustJsMapTargetTypes(iterable);
  if (mapTypes !== undefined && rustCarrierSupportsClone(mapTypes.key, definitions) &&
    rustCarrierSupportsClone(mapTypes.value, definitions)) {
    return {
      kind: "receiver-method",
      elementCarrier: { kind: "tuple", elements: [mapTypes.key, mapTypes.value] },
      method: "entries",
    };
  }
  const setElement = getRustJsSetElementTargetType(iterable);
  if (setElement !== undefined && rustCarrierSupportsClone(setElement, definitions)) {
    return { kind: "receiver-method", elementCarrier: setElement, method: "values" };
  }
  if (iterable?.kind === "target-named") {
    if (iterable.id === rustRegExpStringIteratorTargetId) {
      return {
        kind: "fallible-owned",
        elementCarrier: rustRegExpExecArrayTargetType(),
      };
    }
    if (iterable.id === rustJsRegExpStringIteratorTargetId) {
      return {
        kind: "fallible-owned",
        elementCarrier: rustJsRegExpExecArrayTargetType(),
      };
    }
  }
  const generator = getRustGeneratorProtocol(iterable);
  return generator === undefined
    ? undefined
    : {
        kind: generator.kind === "sync" ? "sync-generator" : "async-generator",
        elementCarrier: generator.yieldType,
      };
}

export function selectRustIterationLowering(
  source: Exclude<import("@tsonic/tsts").ResolvedSourceIterationInfo, { readonly iterationKind: "for-in" }>,
  target: RustIterableTargetPolicy,
  consumeResult: boolean,
): Extract<
  RustTargetOperationFact,
  { readonly kind: "iteration"; readonly iterationKind: "for-of" | "for-await-of" }
>["lowering"] | undefined {
  if (source.mechanism.kind === "union" || source.mechanism.kind === "untyped-dynamic-iteration") {
    return undefined;
  }
  if (target.kind === "owned-call") {
    return source.mechanism.kind === "asynchronous-iterator-protocol"
      ? undefined
      : { kind: "owned-call", path: target.path };
  }
  if (source.iterationKind === "for-of") {
    if (target.kind === "async-generator") {
      return undefined;
    }
    if (target.kind === "borrowed") {
      if (consumeResult) {
        return { kind: "owned" };
      }
      return {
        kind: "borrowed",
        style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned",
        input: target.input,
      };
    }
    if (target.kind === "receiver-method") {
      return { kind: "receiver-method", name: target.method };
    }
    return target.kind === "js-array"
      ? { kind: "js-array" }
      : target.kind === "fallible-owned"
        ? { kind: "fallible-owned" }
        : target.kind === "sync-generator" ? { kind: "sync-generator" } : { kind: "owned" };
  }
  if (source.mechanism.kind === "asynchronous-iterator-protocol") {
    return target.kind === "async-generator" ? { kind: "async-generator" } : undefined;
  }
  if (target.kind === "async-generator") {
    return undefined;
  }
  if (target.kind === "borrowed") {
    if (consumeResult) {
      return { kind: "owned" };
    }
    return {
      kind: "borrowed",
      style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned",
      input: target.input,
    };
  }
  if (target.kind === "receiver-method") {
    return { kind: "receiver-method", name: target.method };
  }
  return target.kind === "js-array"
    ? { kind: "js-array" }
    : target.kind === "fallible-owned"
      ? { kind: "fallible-owned" }
      : target.kind === "sync-generator" ? { kind: "sync-generator" } : { kind: "owned" };
}
