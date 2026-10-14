import { setCarrierFact } from "../operations/project-calls.js";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { selectRustRegularExpressionLiteral } from "../../policy/operations/syntax/regexp-literal.js";

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
  walk.context.records.targetOperations.source(expression, selected.operation);
  return setCarrierFact(walk, expression, selected.targetType);
}
