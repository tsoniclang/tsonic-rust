import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import { rustSourceOptionalTargetType, rustStringTargetType } from "../../../../target-model/types/index.js";
import { rustCarrierProvidesErrorMutation } from "../../../constraints/error-protocols.js";

export function selectRustBuiltinErrorPropertyForm(
  memberName: string, accessMode: Extract<RustTargetOperationFact, { readonly kind: "builtin-error-property" }>["accessMode"] | "delete",
  receiverCarrier: TargetTypeRef, definitions: RustTypeDefinitions,
): { readonly kind: "selected"; readonly fact: Extract<RustTargetOperationFact, { readonly kind: "builtin-error-property" }> }
 | { readonly kind: "rejected"; readonly code: string; readonly message: string } {
  if (accessMode === "delete") return { kind: "rejected", code: "RUST_BUILTIN_ERROR_DELETE_UNSUPPORTED",
    message: "An admitted native Error field cannot be removed from its physical storage." };
  if (accessMode !== "read" && !rustCarrierProvidesErrorMutation(receiverCarrier, definitions)) {
    return { kind: "rejected", code: "RUST_BUILTIN_ERROR_MUTATION_UNSUPPORTED",
      message: "The exact selected native Error storage is immutable; writable Error admission requires an original physical setter owner." };
  }
  if (memberName !== "message" && memberName !== "name" && memberName !== "stack") {
    return { kind: "rejected", code: "RUST_BUILTIN_ERROR_PROPERTY_UNSUPPORTED",
      message: "The selected builtin Error member has no exact native runtime property contract." };
  }
  return { kind: "selected", fact: { kind: "builtin-error-property", accessMode,
    operationId: `tsonic.rust.error.property.${memberName}`, receiverCarrier,
    resultCarrier: memberName === "stack" ? rustSourceOptionalTargetType(rustStringTargetType()) : rustStringTargetType(),
    property: memberName } };
}
