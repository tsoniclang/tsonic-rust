import type { RustBinaryOperatorSelection } from "./operator-rules.js";
import { selectRustSourceValueConversion } from "../conversions/selection.js";
import { rustJsNumericTargetType, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustBinaryOperator } from "../../target-model/syntax/tokens.js";

const comparisonMethods: Readonly<Record<string, readonly [string, RustBinaryOperator]>> = {
  KindLessThanToken: ["less_than", "<"],
  KindLessThanEqualsToken: ["less_than_or_equal", "<="],
  KindGreaterThanToken: ["greater_than", ">"],
  KindGreaterThanEqualsToken: ["greater_than_or_equal", ">="],
  KindEqualsEqualsToken: ["loose_equal", "=="],
  KindExclamationEqualsToken: ["loose_not_equal", "!="],
  KindEqualsEqualsEqualsToken: ["strict_equal", "=="],
  KindExclamationEqualsEqualsToken: ["strict_not_equal", "!="],
};

export function selectRustNumericUnionComparison(
  operator: string,
  left: TargetTypeRef,
  right: TargetTypeRef,
): RustBinaryOperatorSelection | undefined {
  const target = rustJsNumericTargetType();
  const leftMatches = rustTargetTypeRefEquals(left, target);
  const rightMatches = rustTargetTypeRefEquals(right, target);
  const method = comparisonMethods[operator];
  if ((!leftMatches && !rightMatches) || method === undefined) return undefined;
  const leftConversion = leftMatches ? undefined : selectRustSourceValueConversion(left, target);
  const rightConversion = rightMatches ? undefined : selectRustSourceValueConversion(right, target);
  if (!leftMatches && leftConversion === undefined || !rightMatches && rightConversion === undefined) return undefined;
  return {
    kind: "operator-call",
    rustOperator: method[1],
    path: `js_abi::JsNumeric::${method[0]}`,
    resultCarrier: rustSourcePrimitiveTargetType("bool"),
    fallible: false,
    operandModes: ["ref", "ref"],
    ...(leftConversion === undefined ? {} : { leftConversion }),
    ...(rightConversion === undefined ? {} : { rightConversion }),
  };
}
