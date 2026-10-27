import type { SourceLiteralValue } from "@tsonic/target-api/source";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustAbsenceCarrier, isRustUnitCarrier, isRustNeverCarrier, isRustOptionCarrier,
  rustOptionElementCarrier, rustOptionValueCarrier, rustSourceOptionalTargetType, rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { rustOptionalStorageValue, rustOptionalStorageNestingDepth } from "../../../target-model/types/projections.js";
import { rustOptionNestingDepth } from "../../../target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustRuntimeUnionContract, rustRuntimeUnionProjection } from "../../../target-model/types/carriers/runtime-unions.js";
import { rustOptionEqualityContract } from "./option-equality.js";
import { selectedIntegerLiteralJoin } from "../../conversions/literals.js";
import { rustNumericPromotionConversion } from "../numeric/promotion.js";
import type { selectedOptionNullishRelationship } from "./nullish-comparisons.js";

export function selectRustNullishAssignmentOperation(
  left: TargetTypeRef, right: TargetTypeRef, rightValue: TargetTypeRef | undefined, storage: TargetTypeRef | undefined,
): RustTargetOperationFact | undefined {
  const inner = rustOptionalStorageValue(left) ?? rustOptionElementCarrier(left);
  const presentResult = inner !== undefined && rustTargetTypeRefEquals(inner, rightValue) ? "value"
    : inner !== undefined && rustTargetTypeRefEquals(left, rightValue) ? "option"
      : inner === undefined && !isRustAbsenceCarrier(left) && rustTargetTypeRefEquals(left, rightValue) ? "identity" : undefined;
  return presentResult === undefined || rightValue === undefined || storage === undefined || !rustTargetTypeRefEquals(storage, right)
    ? undefined : { kind: "nullish-assignment", operationId: "tsonic.rust.assignment.nullish", readCarrier: left,
      rightCarrier: rightValue, presentResult,
      assignment: { kind: "operator-token", operationId: "tsonic.rust.assignment.nullish.write", operator: "=",
        resultCarrier: storage, operandModes: ["mut-ref", "value"] },
      resultCarrier: presentResult === "value" ? inner! : left };
}

export function selectRustCoalesceOperation(
  left: TargetTypeRef | undefined, right: TargetTypeRef | undefined, rawRight: TargetTypeRef | undefined,
  literal: SourceLiteralValue | undefined, absenceRight: TargetTypeRef | undefined,
): RustTargetOperationFact | undefined {
  const inner = rustOptionalStorageValue(left) ?? (isRustOptionCarrier(left) ? rustOptionValueCarrier(left) : undefined);
  const leftOptionDepth = rustOptionalStorageNestingDepth(left, inner);
  const integerJoin = selectedIntegerLiteralJoin(literal, inner);
  const leftConversion = inner?.kind === "source-primitive" && integerJoin?.kind === "source-primitive"
    ? rustNumericPromotionConversion(inner.name, integerJoin.name) : undefined;
  if (inner !== undefined && right !== undefined && leftOptionDepth !== undefined &&
    (rustTargetTypeRefEquals(inner, right) || isRustNeverCarrier(right) || leftConversion !== undefined && rustTargetTypeRefEquals(integerJoin, right))) {
    return { kind: "option-coalesce", operationId: "tsonic.rust.option.coalesce", leftOptionDepth, rightOptionDepth: 0,
      rightValueForm: "value", leftValueCarrier: inner, ...(leftConversion === undefined ? {} : { leftConversion }),
      resultCarrier: leftConversion === undefined ? inner : integerJoin! };
  }
  if (inner !== undefined && right !== undefined && leftOptionDepth !== undefined &&
    isRustOptionCarrier(right) && rustTargetTypeRefEquals(inner, rustOptionValueCarrier(right))) {
    const rawDepth = isRustOptionCarrier(rawRight) ? rustOptionNestingDepth(rawRight, inner) : undefined;
    return { kind: "option-coalesce", operationId: "tsonic.rust.option.coalesce-option", leftOptionDepth,
      rightOptionDepth: rawDepth ?? rustOptionNestingDepth(right, inner)!, rightValueForm: rawDepth === undefined ? "value" : "raw",
      leftValueCarrier: inner, resultCarrier: rustSourceOptionalTargetType(inner) };
  }
  if (inner !== undefined && isRustAbsenceCarrier(right) && leftOptionDepth !== undefined) {
    const resultCarrier = rustSourceOptionalTargetType(inner);
    return !rustTargetTypeRefEquals(absenceRight, resultCarrier) ? undefined
      : { kind: "option-coalesce", operationId: "tsonic.rust.option.coalesce-option", leftOptionDepth, rightOptionDepth: 1,
        rightValueForm: "value", leftValueCarrier: inner, resultCarrier };
  }
  return left !== undefined && right !== undefined && (rustTargetTypeRefEquals(left, right) || isRustNeverCarrier(right)) &&
    !isRustOptionCarrier(left) && rustOptionalStorageValue(left) === undefined && !isRustAbsenceCarrier(left) &&
    rustRuntimeUnionContract(left)?.alternatives.some(alternative => isRustAbsenceCarrier(alternative.carrier)) !== true
    ? { kind: "nullish-identity", operationId: "tsonic.rust.nullish.identity", resultCarrier: left } : undefined;
}

export function selectRustAbsenceComparisonOperation(
  operator: string, left: TargetTypeRef | undefined, right: TargetTypeRef | undefined,
  leftComparison: TargetTypeRef | undefined, rightComparison: TargetTypeRef | undefined,
  relationship: ReturnType<typeof selectedOptionNullishRelationship>,
): RustTargetOperationFact | undefined {
  const strict = operator === "KindEqualsEqualsEqualsToken" || operator === "KindExclamationEqualsEqualsToken";
  const negated = operator === "KindExclamationEqualsEqualsToken";
  const operand = isRustOptionCarrier(leftComparison) || rustOptionalStorageValue(leftComparison) !== undefined ? "left"
    : isRustOptionCarrier(rightComparison) || rustOptionalStorageValue(rightComparison) !== undefined ? "right" : undefined;
  const optionCarrier = operand === "left" ? leftComparison : operand === "right" ? rightComparison : undefined;
  const nullishCarrier = operand === "left" ? rightComparison : operand === "right" ? leftComparison : undefined;
  if (strict && relationship !== undefined && relationship.depths.length > 0 && operand !== undefined &&
    optionCarrier !== undefined && nullishCarrier !== undefined) {
    const selectedNegated = negated !== relationship.negated;
    return { kind: "option-check", operationId: selectedNegated ? "tsonic.rust.option.is-some" : "tsonic.rust.option.is-none",
      negated: selectedNegated, optionOperand: operand, optionCarrier, nullishCarrier, nullishDepths: relationship.depths };
  }
  if (strict && relationship?.depths.length === 0) return { kind: "constant-equality",
    operationId: negated ? "tsonic.rust.equality.option-nullish-constant.not-equal" : "tsonic.rust.equality.option-nullish-constant.equal",
    resultCarrier: rustSourcePrimitiveTargetType("bool"), value: negated !== relationship.negated };
  if ((strict || operator === "KindEqualsEqualsToken" || operator === "KindExclamationEqualsToken") &&
    isRustUnitCarrier(left) && isRustUnitCarrier(right)) {
    const different = negated || operator === "KindExclamationEqualsToken";
    return { kind: "constant-equality", operationId: different ? "tsonic.rust.equality.nullish.not-equal" : "tsonic.rust.equality.nullish.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"), value: !different };
  }
  if (strict && (isRustAbsenceCarrier(left) && right !== undefined && !isRustAbsenceCarrier(right) &&
    !isRustOptionCarrier(right) && rustOptionalStorageValue(right) === undefined && left !== undefined &&
    rustRuntimeUnionProjection(right, left) === undefined || isRustAbsenceCarrier(right) && left !== undefined &&
    !isRustAbsenceCarrier(left) && !isRustOptionCarrier(left) && rustOptionalStorageValue(left) === undefined && right !== undefined &&
    rustRuntimeUnionProjection(left, right) === undefined)) return { kind: "constant-equality",
      operationId: negated ? "tsonic.rust.equality.disjoint.not-equal" : "tsonic.rust.equality.disjoint.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"), value: negated };
  const equality = strict ? rustOptionEqualityContract(leftComparison, rightComparison) : undefined;
  return equality === undefined ? undefined : { kind: "option-equality",
    operationId: negated ? "tsonic.rust.option.not-equal" : "tsonic.rust.option.equal", negated, ...equality };
}
