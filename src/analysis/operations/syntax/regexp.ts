import { requireRustRecord } from "../../program/records/objects/required-records.js";
import { setCarrierFact } from "../project-calls.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { selectRustRegularExpressionLiteral } from "../../../policy/operations/syntax/regexp-literal.js";

export function resolveRegExpCreation(
  walk: RustFactWalk,
  expression: Node,
  pattern: string,
  flags: string,
): TargetTypeRef | undefined {
  if (!walk.jsEnabled) {
    return undefined;
  }
  const selected = selectRustRegularExpressionLiteral(pattern, flags);
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, selected.operation.kind, "analysis/operations/syntax/regexp.ts");
  walk.context.records.targetOperations.source(expression, selected.operation);
  return setCarrierFact(walk, expression, selected.targetType);
}
