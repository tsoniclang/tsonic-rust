import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustUnionEqualityArm } from "../../../target-model/operations/binary.js";
import { rustUnionAlternatives, rustUnionLeaves } from "../../../target-model/types/union-relations.js";
import { getRustTypeofRuntimeKind } from "../../../target-model/types/runtime-kind.js";
import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { selectRustBinaryOperator } from "./rules.js";

export function selectRustUnionEquality(
  left: TargetTypeRef,
  right: TargetTypeRef,
  definitions: RustTypeDefinitions,
): { readonly arms: readonly RustUnionEqualityArm[]; readonly exhaustive: boolean } | undefined {
  const leftUnion = rustUnionAlternatives(left, definitions);
  const rightUnion = rustUnionAlternatives(right, definitions);
  if (leftUnion === undefined && rightUnion === undefined) return undefined;
  const leftLeaves = leftUnion === undefined ? [{ carrier: left, path: [] }] : rustUnionLeaves(left, definitions);
  const rightLeaves = rightUnion === undefined ? [{ carrier: right, path: [] }] : rustUnionLeaves(right, definitions);
  if (leftLeaves === undefined || rightLeaves === undefined) return undefined;
  const arms: RustUnionEqualityArm[] = [];
  for (const left of leftLeaves) for (const right of rightLeaves) {
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
