import { rustJsArrayEntriesElementTargetType } from "../../../../target-model/types/carriers/array-entries.js";
import { isRustBigIntCarrier, getRustJsMapTargetTypes, getRustJsSetElementTargetType, getRustJsWeakMapTargetTypes, getRustJsWeakSetElementTargetType, isRustBoolCarrier, rustJsArrayLikeElementTargetType, isRustJsArrayValueCarrier, rustJsStringTargetId, rustStringTargetId, isRustNumericCarrier, rustJsDateTargetId, rustJsArrayBufferTargetId, rustJsDataViewTargetId, rustJsIntlCollatorTargetId, rustJsIntlDateTimeFormatPartTargetId, rustJsIntlDateTimeFormatTargetId, rustJsIntlNumberFormatPartTargetId, rustJsIntlNumberFormatTargetId, rustJsIntlResolvedCollatorOptionsTargetId, rustJsIntlResolvedDateTimeFormatOptionsTargetId, rustJsIntlResolvedNumberFormatOptionsTargetId, rustJsTypedArrayElementTargetType, rustJsTypedArrayTargetIds, rustJsPromiseOutputTargetType, rustJsPromiseFulfilledResultTargetId, rustJsPromiseRejectedResultTargetId, rustJsPromiseSettledResultTargetId, rustJsRegExpNamedGroupsTargetId, rustJsRegExpNamedIndicesTargetId, rustJsRegExpStringIteratorTargetId, rustJsRegExpTargetId, rustRegExpNamedGroupsTargetId, rustRegExpNamedIndicesTargetId, rustRegExpStringIteratorTargetId, isRustCallableCarrier } from "../../../../target-model/types/index.js";

import { isRustStringViewCarrier } from "../../../../target-model/types/carriers/native.js";

import type { JsLane } from "./model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { type JsLaneBindings } from "./carrier-references.js";

const nativeLanes: ReadonlyMap<string, JsLane> = new Map([
  [rustJsDateTargetId, "date"],
  [rustJsPromiseFulfilledResultTargetId, "promise-record"],
  [rustJsPromiseRejectedResultTargetId, "promise-record"],
  [rustJsPromiseSettledResultTargetId, "promise-record"],
  [rustJsArrayBufferTargetId, "array-buffer"],
  [rustJsDataViewTargetId, "data-view"],
  [rustJsIntlDateTimeFormatTargetId, "intl-date-time"],
  [rustJsIntlNumberFormatTargetId, "intl-number"],
  [rustJsIntlCollatorTargetId, "intl-collator"],
  [rustJsIntlDateTimeFormatPartTargetId, "intl-record"],
  [rustJsIntlNumberFormatPartTargetId, "intl-record"],
  [rustJsIntlResolvedCollatorOptionsTargetId, "intl-record"],
  [rustJsIntlResolvedDateTimeFormatOptionsTargetId, "intl-record"],
  [rustJsIntlResolvedNumberFormatOptionsTargetId, "intl-record"],
  [rustJsRegExpTargetId, "regexp"],
  [rustRegExpNamedGroupsTargetId, "regexp-named-groups"],
  [rustJsRegExpNamedGroupsTargetId, "regexp-named-groups"],
  [rustRegExpNamedIndicesTargetId, "regexp-named-indices"],
  [rustJsRegExpNamedIndicesTargetId, "regexp-named-indices"],
  [rustRegExpStringIteratorTargetId, "regexp-string-iterator"],
  [rustJsRegExpStringIteratorTargetId, "regexp-string-iterator"],
]);
const staticLanes: ReadonlyMap<string, JsLane> = new Map([
  ["StringConstructor", "string"],
  ["ArrayConstructor", "js-array"],
  ["DateConstructor", "date"],
  ["JSON", "json"],
  ["Math", "math"],
  ["NumberConstructor", "number"],
  ["BigIntConstructor", "bigint"],
  ["Global", "global"],
  ["Atomics", "global"],
  ["Console", "console"],
  ["ObjectConstructor", "object"],
  ["RegExpConstructor", "regexp"],
  ["SymbolConstructor", "symbol"],
  ["PromiseConstructor", "promise"],
  ...Object.keys(rustJsTypedArrayTargetIds).map(name => [`${name}Constructor`, "typed-array"] as const),
]);
export function selectJsSurfaceLane(carrier: TargetTypeRef | undefined, ownerName: string): { readonly lane: JsLane; readonly bindings: JsLaneBindings } | undefined {
  if (isRustJsArrayValueCarrier(carrier)) {
    return { lane: "array-value", bindings: { receiver: carrier } };
  }
  if (carrier?.kind === "reference" && carrier.referent.kind === "target-named" && carrier.referent.id === rustStringTargetId) {
    return { lane: "string", bindings: { receiver: carrier.referent } };
  }
  if (carrier?.kind === "target-named") {
    const arrayElement = rustJsArrayLikeElementTargetType(carrier);
    if (arrayElement !== undefined) {
      return { lane: "js-array", bindings: { element: arrayElement, receiver: carrier } };
    }
    const mapTypes = getRustJsMapTargetTypes(carrier);
    if (mapTypes !== undefined) {
      return { lane: "map", bindings: { mapKey: mapTypes.key, mapValue: mapTypes.value, receiver: carrier } };
    }
    const setValue = getRustJsSetElementTargetType(carrier);
    if (setValue !== undefined) {
      return { lane: "set", bindings: { setValue, receiver: carrier } };
    }
    const weakMapTypes = getRustJsWeakMapTargetTypes(carrier);
    if (weakMapTypes !== undefined) {
      return {
        lane: "weak-map",
        bindings: {
          weakKey: weakMapTypes.key,
          weakValue: weakMapTypes.value,
          receiver: carrier,
        },
      };
    }
    const weakSetValue = getRustJsWeakSetElementTargetType(carrier);
    if (weakSetValue !== undefined) {
      return { lane: "weak-set", bindings: { weakKey: weakSetValue, receiver: carrier } };
    }
    const entryElement = rustJsArrayEntriesElementTargetType(carrier);
    if (entryElement !== undefined) {
      return { lane: "array-entries", bindings: { element: entryElement, receiver: carrier } };
    }

    const promiseOutput = rustJsPromiseOutputTargetType(carrier);
    if (promiseOutput !== undefined) {
      return {
        lane: "promise",
        bindings: { promiseOutput, receiver: carrier },
      };
    }

    const nativeLane = nativeLanes.get(carrier.id);
    if (nativeLane !== undefined) return { lane: nativeLane, bindings: { receiver: carrier } };
    const typedElement = rustJsTypedArrayElementTargetType(carrier);
    if (typedElement !== undefined) {
      return {
        lane: "typed-array",
        bindings: {
          element: typedElement,
          receiver: carrier,
        },
      };
    }

  }
  if (isRustStringViewCarrier(carrier)) {
    return { lane: "string", bindings: { receiver: carrier } };
  }
  if (carrier?.kind === "target-named" && carrier.id === rustJsStringTargetId) {
    return { lane: "js-string", bindings: { receiver: carrier } };
  }
  if (isRustNumericCarrier(carrier)) {
    return { lane: "number", bindings: { receiver: carrier } };
  }
  if (isRustBigIntCarrier(carrier)) {
    return { lane: "bigint", bindings: { receiver: carrier } };
  }
  if (isRustBoolCarrier(carrier)) {
    return { lane: "boolean", bindings: { receiver: carrier } };
  }
  const staticReceiver = carrier === undefined || isRustCallableCarrier(carrier);
  const staticLane = staticReceiver ? staticLanes.get(ownerName) : undefined;
  return staticLane === undefined ? undefined : { lane: staticLane, bindings: {} };
}
