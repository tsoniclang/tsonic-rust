import { rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function rustEnumLiteralFact(name: string, resultCarrier: TargetTypeRef): RustTargetOperationFact {
  return { kind: "source-enum-member", operationId: `tsonic.rust.union.variant:${name}`, name,
    enumRepresentation: { kind: "literal-union" }, resultCarrier };
}

export function rustUnaryMinusLiteralFact(resultCarrier: TargetTypeRef): RustTargetOperationFact {
  return { kind: "operator-token", operationId: rustPostCheckUnaryMinusOperationId,
    operator: "-", resultCarrier, operandModes: ["value"] };
}

export function rustUnaryPlusLiteralFact(resultCarrier: TargetTypeRef): RustTargetOperationFact {
  return { kind: "source-conversion", operationId: rustPostCheckUnaryPlusOperationId, resultCarrier };
}
