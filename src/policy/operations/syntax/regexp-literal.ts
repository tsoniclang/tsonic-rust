import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustJsRegExpTargetType } from "../../../target-model/types/carriers/js.js";

export function selectRustRegularExpressionLiteral(
  pattern: string,
  flags: string,
): {
  readonly operation: Extract<RustTargetOperationFact, { readonly kind: "regexp-create" }>;
  readonly targetType: TargetTypeRef;
} {
  return Object.freeze({
    operation: Object.freeze({
      kind: "regexp-create",
      operationId: "tsonic.rust.js.regexp.create",
      pattern,
      flags,
    }),
    targetType: Object.freeze(rustJsRegExpTargetType()),
  });
}
