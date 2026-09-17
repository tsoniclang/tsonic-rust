import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { JsOperationRequest } from "./model.js";
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
  if (expected.kind === "closure" && actual.kind === "closure") {
    if (expected.args.length !== actual.args.length) {
      return relationScore?.(expected, actual, index);
    }
    const scores = [
      ...expected.args.map((argument, argumentIndex) =>
        jsArgumentCarrierMatchScore(argument, actual.args[argumentIndex], index, relationScore)),
      jsArgumentCarrierMatchScore(expected.result, actual.result, index, relationScore),
    ];
    return scores.some((score) => score === undefined)
      ? relationScore?.(expected, actual, index)
      : (scores as number[]).reduce((total, score) => total + score, 0);
  }
  if (rustTargetTypeRefEquals(expected, actual)) {
    return 0;
  }
  return relationScore?.(expected, actual, index);
}
