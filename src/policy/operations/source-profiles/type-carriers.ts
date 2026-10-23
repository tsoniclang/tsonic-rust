import { rustSourceErrorConstructors } from "../../../target-model/identities/source-errors.js";
import { rustJsArrayEntriesTargetType } from "../../../target-model/types/carriers/array-entries.js";
import { rustFutureTargetType, rustGeneratorTargetType, rustAsyncGeneratorTargetType, rustIteratorResultTargetType, rustJsArrayTargetType, rustJsArrayBufferTargetType, rustJsDataViewTargetType, rustJsDateTargetType, rustJsMapTargetType, rustJsPromiseTargetType, rustJsPromiseFulfilledResultTargetType, rustJsPromiseRejectedResultTargetType, rustJsPromiseSettledResultTargetType, rustJsIntlCollatorTargetType, rustJsIntlDateTimeFormatPartTargetType, rustJsIntlDateTimeFormatTargetType, rustJsIntlNumberFormatPartTargetType, rustJsIntlNumberFormatTargetType, rustJsIntlResolvedCollatorOptionsTargetType, rustJsIntlResolvedDateTimeFormatOptionsTargetType, rustJsIntlResolvedNumberFormatOptionsTargetType, rustJsRegExpExecArrayTargetType, rustJsRegExpIndicesTargetType, rustJsRegExpMatchArrayTargetType, rustJsRegExpNamedGroupsTargetType, rustJsRegExpNamedIndicesTargetType, rustJsRegExpStringIteratorTargetType, rustJsRegExpTargetType, rustJsSetTargetType, rustJsTypedArrayTargetType, rustJsWeakMapTargetType, rustJsWeakSetTargetType, rustRegExpExecArrayTargetType, rustRegExpIndicesTargetType, rustRegExpMatchArrayTargetType, rustRegExpNamedGroupsTargetType, rustRegExpNamedIndicesTargetType, rustRegExpStringIteratorTargetType, rustStringTargetType, rustVecTargetType } from "../../../target-model/types/index.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

const regExpIdentity = jsRegExpSourceProfileIdentity;
const regExpResultCarrierByOwner = new Map<string, () => TargetTypeRef>([
  [regExpIdentity.owners.regExpExecArray, rustRegExpExecArrayTargetType],
  [regExpIdentity.owners.regExpMatchArray, rustRegExpMatchArrayTargetType],
  [regExpIdentity.owners.regExpIndicesArray, rustRegExpIndicesTargetType],
  [regExpIdentity.owners.regExpNamedGroups, rustRegExpNamedGroupsTargetType],
  [regExpIdentity.owners.regExpNamedIndices, rustRegExpNamedIndicesTargetType],
  [regExpIdentity.owners.jsRegExpExecArray, rustJsRegExpExecArrayTargetType],
  [regExpIdentity.owners.jsRegExpMatchArray, rustJsRegExpMatchArrayTargetType],
  [regExpIdentity.owners.jsRegExpIndicesArray, rustJsRegExpIndicesTargetType],
  [regExpIdentity.owners.jsRegExpNamedGroups, rustJsRegExpNamedGroupsTargetType],
  [regExpIdentity.owners.jsRegExpNamedIndices, rustJsRegExpNamedIndicesTargetType],
]);

export function selectRustSourceProfileCompletionKind(
  name: string, jsEnabled: boolean,
): "native-future" | "js-promise" | undefined {
  return name === "Promise" || name === "PromiseLike" ? jsEnabled ? "js-promise" : "native-future" : undefined;
}

export function resolveSourceProfileCarrierFromArguments(
  name: string,
  arguments_: readonly TargetTypeRef[],
  options: { readonly jsEnabled: boolean; readonly sourceErrorCarrier: TargetTypeRef | undefined },
): TargetTypeRef | undefined {
  const fixed = selectRustFixedSourceProfileCarrier(name, options.jsEnabled);
  if (fixed !== undefined) return fixed;
  if (options.jsEnabled && name === "ArrayEntriesIterator" && arguments_.length === 1) {
    return rustJsArrayEntriesTargetType(arguments_[0]!);
  }
  if (arguments_.length === 0 && rustSourceProfileErrorCarrierNeeded(name, options.jsEnabled)) {
    return options.sourceErrorCarrier;
  }
  const completion = selectRustSourceProfileCompletionKind(name, options.jsEnabled);
  if (completion !== undefined) {
    const [output] = arguments_;
    return output === undefined
      ? undefined
      : completion === "js-promise"
        ? rustJsPromiseTargetType(output)
        : rustFutureTargetType(output);
  }
  if (options.jsEnabled && name === "PromiseFulfilledResult") {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsPromiseFulfilledResultTargetType(value);
  }
  if (options.jsEnabled && name === "PromiseRejectedResult" && arguments_.length === 0) {
    return rustJsPromiseRejectedResultTargetType();
  }
  if (options.jsEnabled && name === "PromiseSettledResult") {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsPromiseSettledResultTargetType(value);
  }
  if (name === "Generator" || name === "AsyncGenerator") {
    const [yieldType, returnType, nextType] = arguments_;
    if (yieldType === undefined || returnType === undefined || nextType === undefined) {
      return undefined;
    }
    const protocol = { yieldType, returnType, nextType };
    return name === "Generator"
      ? rustGeneratorTargetType(protocol)
      : rustAsyncGeneratorTargetType(protocol);
  }
  if (name === "IteratorResult" || name === "IteratorYieldResult" || name === "IteratorReturnResult") {
    const yieldType = arguments_[0];
    const returnType = name === "IteratorYieldResult" ? yieldType : arguments_[1] ?? yieldType;
    return yieldType === undefined || returnType === undefined
      ? undefined
      : rustIteratorResultTargetType({ yieldType, returnType });
  }
  if (name === "Array" || name === "ReadonlyArray") {
    const [element] = arguments_;
    if (element === undefined) {
      return undefined;
    }
    return options.jsEnabled ? rustJsArrayTargetType(element) : rustVecTargetType(element);
  }
  if (options.jsEnabled && (name === "Map" || name === "ReadonlyMap")) {
    const [key, value] = arguments_;
    return key === undefined || value === undefined ? undefined : rustJsMapTargetType(key, value);
  }
  if (options.jsEnabled && (name === "Set" || name === "ReadonlySet")) {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsSetTargetType(value);
  }
  if (options.jsEnabled && name === "WeakMap") {
    const [key, value] = arguments_;
    return key === undefined || value === undefined ? undefined : rustJsWeakMapTargetType(key, value);
  }
  if (options.jsEnabled && name === "WeakSet") {
    const [value] = arguments_;
    return value === undefined ? undefined : rustJsWeakSetTargetType(value);
  }
  if (options.jsEnabled && name === regExpIdentity.owners.regExpStringIterator) {
    const [element] = arguments_;
    return arguments_.length === 1 && element !== undefined &&
        rustTargetTypeRefEquals(element, rustRegExpExecArrayTargetType())
      ? rustRegExpStringIteratorTargetType()
      : undefined;
  }
  if (options.jsEnabled && name === regExpIdentity.owners.jsRegExpStringIterator) {
    const [element] = arguments_;
    return arguments_.length === 1 && element !== undefined &&
        rustTargetTypeRefEquals(element, rustJsRegExpExecArrayTargetType())
      ? rustJsRegExpStringIteratorTargetType()
      : undefined;
  }
  return undefined;
}

function rustDirectJsSourceProfileCarrier(name: string): TargetTypeRef | undefined {
  switch (name) {
    case "ArrayBuffer":
    case "SharedArrayBuffer": return rustJsArrayBufferTargetType();
    case "DataView": return rustJsDataViewTargetType();
    case "Int8Array": return rustJsTypedArrayTargetType("Int8Array");
    case "Uint8Array": return rustJsTypedArrayTargetType("Uint8Array");
    case "Uint8ClampedArray": return rustJsTypedArrayTargetType("Uint8ClampedArray");
    case "Int16Array": return rustJsTypedArrayTargetType("Int16Array");
    case "Uint16Array": return rustJsTypedArrayTargetType("Uint16Array");
    case "Int32Array": return rustJsTypedArrayTargetType("Int32Array");
    case "Uint32Array": return rustJsTypedArrayTargetType("Uint32Array");
    case "Float32Array": return rustJsTypedArrayTargetType("Float32Array");
    case "Float64Array": return rustJsTypedArrayTargetType("Float64Array");
    case "IntlDateTimeFormat": return rustJsIntlDateTimeFormatTargetType();
    case "IntlNumberFormat": return rustJsIntlNumberFormatTargetType();
    case "IntlCollator": return rustJsIntlCollatorTargetType();
    case "IntlDateTimeFormatPart": return rustJsIntlDateTimeFormatPartTargetType();
    case "IntlNumberFormatPart": return rustJsIntlNumberFormatPartTargetType();
    case "IntlResolvedDateTimeFormatOptions": return rustJsIntlResolvedDateTimeFormatOptionsTargetType();
    case "IntlResolvedNumberFormatOptions": return rustJsIntlResolvedNumberFormatOptionsTargetType();
    case "IntlResolvedCollatorOptions": return rustJsIntlResolvedCollatorOptionsTargetType();
    default: return undefined;
  }
}

export function selectRustFixedSourceProfileCarrier(name: string, jsEnabled: boolean): TargetTypeRef | undefined {
  if (name === "String") return rustStringTargetType();
  if (!jsEnabled) return undefined;
  if (name === "Date") return rustJsDateTargetType();
  if (name === regExpIdentity.owners.regExp) return rustJsRegExpTargetType();
  const regexp = regExpResultCarrierByOwner.get(name);
  return regexp === undefined ? rustDirectJsSourceProfileCarrier(name) : regexp();
}

export function rustSourceProfileErrorCarrierNeeded(name: string, jsEnabled: boolean): boolean {
  return rustSourceErrorConstructors.some(entry => entry.sourceName === name && (name === "Error" || jsEnabled));
}

export function rustSourceProfileUsesArrayStorage(name: string): boolean {
  return name === "Array" || name === "ReadonlyArray";
}
