import { rustClosureCaptureEquals } from "../../../../target-model/records/equality.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";

import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustOptionalChainFact } from "../../../../target-model/operations/model.js";
import type { RustPlanKey } from "../key.js";
import type { RustPreparedOperationResultFact, RustClosureCaptureFact } from "../../../../target-model/records/operation-selections.js";

export const rustPreparedOperationResultFactKey: RustPlanKey<RustPreparedOperationResultFact> =
  defineRustPlanKey("preparedOperationResult", (left, right) =>
    left.operationId === right.operationId &&
    left.operationKind === right.operationKind &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier));

export const rustOptionalChainFactKey: RustPlanKey<RustOptionalChainFact> =
  defineRustPlanKey("optionalChain", (left, right) => {
    const { expression: leftExpression, guard: leftGuard, ...leftMetadata } = left;
    const { expression: rightExpression, guard: rightGuard, ...rightMetadata } = right;
    return leftExpression === rightExpression && leftGuard === rightGuard &&
      closedMetadataEquals(leftMetadata, rightMetadata);
  });

export const rustClosureCaptureFactKey: RustPlanKey<RustClosureCaptureFact> = defineRustPlanKey(
  "closureCaptures",
  rustClosureCaptureEquals,
);
