import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustUnionEqualityArm } from "../../../target-model/operations/binary.js";
import { rustUnionAlternatives, rustUnionLeaves } from "../../../target-model/types/union-relations.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { selectRustBinaryOperator } from "./rules.js";
import { isRustAbsenceCarrier, rustAbsenceTargetType, rustSourcePrimitiveTargetType } from "../../../target-model/types/carriers/native.js";
import { rustSourceOptionalElementCarrier } from "../../../target-model/types/carriers/optional.js";

export function selectRustUnionEquality(
  left: TargetTypeRef,
  right: TargetTypeRef,
  definitions: RustTypeDefinitions,
): { readonly arms: readonly RustUnionEqualityArm[]; readonly exhaustive: boolean } | undefined {
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
    if (isRustAbsenceCarrier(left.carrier) !== isRustAbsenceCarrier(right.carrier)) continue;
    if (isRustAbsenceCarrier(left.carrier)) {
      arms.push({ left, right, operation: { kind: "operator-token", rustOperator: "==", resultCarrier: rustSourcePrimitiveTargetType("bool") } });
      continue;
    }
    const operation = selectRustBinaryOperator("===", left.carrier, right.carrier);
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
