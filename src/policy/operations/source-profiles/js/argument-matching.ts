import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { JsOperationRequest } from "./model.js";
import { rustCallableProtocol, rustClosureProtocol } from "../../../../target-model/types/index.js";
import { isRustStringViewCarrier, rustBorrowedStrTargetType } from "../../../../target-model/types/carriers/native.js";
export function jsArgumentCarrierMatchScore(
  expected: TargetTypeRef | undefined,
  actual: TargetTypeRef | undefined,
  index: number,
  relationScore: JsOperationRequest["argumentMatchScore"],
): number | undefined {
  if (actual === undefined) {
    return expected === undefined
      ? undefined
      : relationScore?.(expected, actual, index);
  }
  if (expected === undefined || (expected.kind === "opaque" && expected.id === "tsonic.rust.infer")) {
    return 0;
  }
  const expectedCallable = rustCallableProtocol(expected) ?? rustClosureProtocol(expected);
  const actualCallable = rustCallableProtocol(actual) ?? rustClosureProtocol(actual);
  if (expectedCallable !== undefined && actualCallable !== undefined) {
    if (expectedCallable.parameters.length !== actualCallable.parameters.length) {
      return relationScore?.(expected, actual, index);
    }
    const scores = [
      ...expectedCallable.parameters.map((argument, argumentIndex) =>
        jsArgumentCarrierMatchScore(argument, actualCallable.parameters[argumentIndex], index, relationScore)),
      jsArgumentCarrierMatchScore(expectedCallable.result, actualCallable.result, index, relationScore),
    ];
    return scores.some((score) => score === undefined)
      ? relationScore?.(expected, actual, index)
      : (scores as number[]).reduce((total, score) => total + score, 0);
  }
  if (rustTargetTypeRefEquals(expected, actual)) {
    return 0;
  }
  if (rustTargetTypeRefEquals(expected, rustBorrowedStrTargetType()) && isRustStringViewCarrier(actual)) {
    return 0;
  }
  return relationScore?.(expected, actual, index);
}
