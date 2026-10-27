import type { RustIndexedRecordPolicyInput } from "../../model/indexed-records.js";
import type { RustIndexedRecordStorageEmission } from "../../../target-model/records/objects/indexed-records.js";
import { rustRecordCarrierValue, rustRecordReadAdmitsAbsence } from "../../../target-model/types/carriers/records.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function selectRustIndexedRecordStorage(input: RustIndexedRecordPolicyInput):
  | { readonly kind: "selected"; readonly value: RustIndexedRecordStorageEmission }
  | { readonly kind: "rejected"; readonly reason: string } {
  if (input.storage.kind === "record") {
    const record = rustRecordCarrierValue(input.carrier);
    if (record === undefined || !rustTargetTypeRefEquals(record.key, input.key) || !rustTargetTypeRefEquals(record.value, input.value)) {
      return { kind: "rejected", reason: "An indexed record requires its exact native key and value carrier contract." };
    }
    return { kind: "selected", value: Object.freeze({ kind: "record", carrier: input.carrier, read: rustRecordReadAdmitsAbsence(input.value) ? "get_or_default" : "get" }) };
  }
  if (input.definition?.kind !== "interface" || input.representation === undefined || input.polymorphic) {
    return { kind: "rejected", reason: "An indexed project record requires its exact non-polymorphic native interface storage." };
  }
  return { kind: "selected", value: Object.freeze({ kind: "project-field", carrier: input.carrier, name: input.storage.name, representation: input.representation }) };
}
