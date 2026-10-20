import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRecordCarrierValue } from "../../target-model/types/carriers/records.js";
import { rustStringTargetType } from "../../target-model/types/carriers/native.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustTsValueAdmission } from "../../target-model/types/carriers/traits.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

export function rustJsSharedObjectValueAdmission(source: TargetTypeRef, definitions: RustTypeDefinitions): boolean {
  return rustStructuralObjectCarrierValue(source)?.representation === "reference" &&
    rustTsValueAdmission(source, definitions) !== undefined;
}

export function rustJsRecordValueAdmission(source: TargetTypeRef): boolean {
  const record = rustRecordCarrierValue(source);
  return record !== undefined && rustTargetTypeRefEquals(record.key, rustStringTargetType()) &&
    rustTargetTypeRefEquals(record.value, rustJsValueTargetType());
}
