import type { TargetTypeRef } from "../types/model.js";
import { isRustCallableCarrier, rustCallableInputProtocol, rustCallableProtocol } from "../types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustGenericCallableValue } from "../types/carriers/generic-callables.js";
import { rustGenericCallableSignaturesMatch } from "./generic-callable.js";

export function rustCallableInvocationSignaturesMatch(source: TargetTypeRef, target: TargetTypeRef): boolean {
  if (rustGenericCallableValue(source) !== undefined || rustGenericCallableValue(target) !== undefined)
    return rustGenericCallableSignaturesMatch(source, target);
  const actual = rustCallableProtocol(source);
  const expected = rustCallableProtocol(target);
  return actual !== undefined && expected !== undefined &&
    actual.parameters.length === expected.parameters.length &&
    actual.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, expected.parameters[index])) &&
    rustTargetTypeRefEquals(actual.result, expected.result);
}

export function rustCallableInputMatches(source: TargetTypeRef, target: TargetTypeRef): boolean {
  const input = rustCallableInputProtocol(target);
  const actual = rustCallableProtocol(source);
  return isRustCallableCarrier(source) && input !== undefined && actual !== undefined &&
    input.parameters.length === actual.parameters.length &&
    input.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, actual.parameters[index])) &&
    rustTargetTypeRefEquals(input.result, actual.result);
}
