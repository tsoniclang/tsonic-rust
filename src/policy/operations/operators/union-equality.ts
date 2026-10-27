import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustUnionEqualityArm } from "../../../target-model/operations/binary.js";
import { rustUnionAlternatives, rustUnionLeaves } from "../../../target-model/types/union-relations.js";
import { getRustTypeofRuntimeKind } from "../syntax/runtime-kind.js";
import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { selectRustBinaryOperator } from "./rules.js";
import { rustAbsenceTargetType, rustSourcePrimitiveTargetType } from "../../../target-model/types/carriers/native.js";
import { isRustUnitCarrier, isRustBoolCarrier } from "../../../target-model/types/carriers/js.js";
import { rustSourceOptionalElementCarrier } from "../../../target-model/types/carriers/optional.js";
import type { RustUnionEqualityOperand, RustUnionEqualityEmission } from "../../../target-model/records/operations/union-equality.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import { rustValueConversionContract } from "../../conversions/contracts.js";

export function selectRustUnionEquality(
  operator: "===" | "!==",
  left: TargetTypeRef,
  right: TargetTypeRef,
  definitions: RustTypeDefinitions,
): { readonly arms: readonly RustUnionEqualityArm[]; readonly exhaustive: boolean } | undefined {
  if (operator !== "===" && operator !== "!==") return undefined;
  const leftPresent = sourceOptionElement(left) ?? left;
  const rightPresent = sourceOptionElement(right) ?? right;
  const leftUnion = rustUnionAlternatives(leftPresent, definitions);
  const rightUnion = rustUnionAlternatives(rightPresent, definitions);
  if (leftUnion === undefined && rightUnion === undefined) return undefined;
  const leftLeaves = equalityLeaves(left, leftPresent, leftUnion !== undefined, definitions);
  const rightLeaves = equalityLeaves(right, rightPresent, rightUnion !== undefined, definitions);
  if (leftLeaves === undefined || rightLeaves === undefined) return undefined;
  const arms: RustUnionEqualityArm[] = [];
  for (const left of leftLeaves) for (const right of rightLeaves) {
    if (isRustUnitCarrier(left.carrier) !== isRustUnitCarrier(right.carrier)) continue;
    if (isRustUnitCarrier(left.carrier)) {
      arms.push({ left, right, operation: { kind: "operator-token", rustOperator: operator === "===" ? "==" : "!=",
        resultCarrier: rustSourcePrimitiveTargetType("bool"), operandModes: ["ref", "ref"] } });
      continue;
    }
    const operation = selectRustBinaryOperator(operator, left.carrier, right.carrier);
    if (operation !== undefined && operation.kind !== "string-concat" &&
      (operation.kind !== "operator-call" || !operation.fallible)) {
      arms.push({ left, right, operation });
      continue;
    }
    const leftKind = getRustTypeofRuntimeKind(left.carrier, definitions);
    const rightKind = getRustTypeofRuntimeKind(right.carrier, definitions);
    if (typeof leftKind !== "string" || typeof rightKind !== "string" || leftKind === rightKind) return undefined;
  }
  return snapshotClosedMetadata({ arms, exhaustive: arms.length === leftLeaves.length * rightLeaves.length });
}

export function selectRustUnionEqualityEmission(
  fact: Extract<RustTargetOperationFact, { readonly kind: "union-equality" }>,
  definitions: RustTypeDefinitions,
): RustUnionEqualityEmission | undefined {
  const side = (arm: RustUnionEqualityOperand["arm"], optional: boolean): RustUnionEqualityOperand => {
    const variant = arm.path[arm.path.length - 1]?.variant;
    return Object.freeze({ arm, optional, absence: isRustUnitCarrier(arm.carrier), value: variant?.kind === "constant"
      ? Object.freeze({ kind: "constant", value: variant.value }) : Object.freeze({ kind: "borrowed" }) });
  };
  const arms: RustUnionEqualityEmission["arms"][number][] = [];
  for (const arm of fact.arms) {
    const left = side(arm.left, rustSourceOptionalElementCarrier(fact.leftCarrier) !== undefined);
    const right = side(arm.right, rustSourceOptionalElementCarrier(fact.rightCarrier) !== undefined);
    const operation = arm.operation;
    const leftConversion = operation.leftConversion === undefined ? undefined : rustValueConversionContract(operation.leftConversion, definitions);
    const rightConversion = operation.rightConversion === undefined ? undefined : rustValueConversionContract(operation.rightConversion, definitions);
    if (operation.leftConversion !== undefined && (leftConversion === undefined || leftConversion.fallible) ||
      operation.rightConversion !== undefined && (rightConversion === undefined || rightConversion.fallible)) return undefined;
    const constant = left.absence && right.absence ? !fact.negated : operation.kind === "operator-token" &&
      leftConversion === undefined && rightConversion === undefined && left.value.kind === "constant" && right.value.kind === "constant"
        ? (left.value.value === right.value.value) !== fact.negated : undefined;
    const booleanOperand = operation.kind === "operator-token" && leftConversion === undefined && rightConversion === undefined &&
      isRustBoolCarrier(arm.left.carrier) && isRustBoolCarrier(arm.right.carrier)
      ? left.value.kind === "constant" ? Object.freeze({ side: "right" as const, negated: left.value.value === fact.negated })
        : right.value.kind === "constant" ? Object.freeze({ side: "left" as const, negated: right.value.value === fact.negated }) : undefined : undefined;
    arms.push(Object.freeze({ left, right, operation, constant, booleanOperand, leftConversion, rightConversion }));
  }
  const allTrue = arms.every(arm => arm.constant === true);
  const allFalse = arms.every(arm => arm.constant === false);
  const unmatchedResult = fact.negated;
  const form: RustUnionEqualityEmission["form"] = arms.length === 0 ? { kind: "constant", value: unmatchedResult }
    : allTrue && (fact.exhaustive || unmatchedResult) ? { kind: "constant", value: true }
    : allFalse && (fact.exhaustive || !unmatchedResult) ? { kind: "constant", value: false }
    : { kind: allTrue ? "matches" : "match" };
  return Object.freeze({ fact, arms: Object.freeze(arms), form: Object.freeze(form), unmatchedResult });
}

function sourceOptionElement(carrier: TargetTypeRef): TargetTypeRef | undefined {
  return carrier.kind === "target-named" ? rustSourceOptionalElementCarrier(carrier) : undefined;
}

function equalityLeaves(
  storage: TargetTypeRef,
  present: TargetTypeRef,
  union: boolean,
  definitions: RustTypeDefinitions,
): readonly RustUnionEqualityArm["left"][] | undefined {
  const leaves = union ? rustUnionLeaves(present, definitions) : [{ carrier: present, path: [] }];
  return leaves === undefined || sourceOptionElement(storage) === undefined ? leaves
    : [...leaves, { carrier: rustAbsenceTargetType(), path: [] }];
}
