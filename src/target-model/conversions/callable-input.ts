import type { TargetTypeRef } from "../types/model.js";
import { isRustCallableCarrier, rustCallableInputProtocol, rustCallableProtocol } from "../types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export function rustCallableInputMatches(source: TargetTypeRef, target: TargetTypeRef): boolean {
  const input = rustCallableInputProtocol(target);
  const actual = rustCallableProtocol(source);
  return isRustCallableCarrier(source) && input !== undefined && actual !== undefined &&
    input.parameters.length === actual.parameters.length &&
    input.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, actual.parameters[index])) &&
    rustTargetTypeRefEquals(input.result, actual.result);
}
