import type { TargetTypeRef } from "../types/model.js";
import { rustRecordCarrierValue } from "../types/carriers/records.js";
import { rustStringTargetType } from "../types/carriers/native.js";
import { rustJsValueTargetType } from "../types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { rustStructuralObjectCarrierValue } from "../types/carriers/source-types.js";
import { rustTsValueAdmission } from "../types/carriers/traits.js";
import type { RustTypeDefinitions } from "../types/source-union-definitions.js";

export function rustJsSharedObjectValueAdmission(source: TargetTypeRef, definitions: RustTypeDefinitions): boolean {
  return rustStructuralObjectCarrierValue(source)?.representation === "reference" &&
    rustTsValueAdmission(source, definitions) !== undefined;
}

export function rustJsRecordValueAdmission(source: TargetTypeRef): boolean {
  const record = rustRecordCarrierValue(source);
  return record !== undefined && rustTargetTypeRefEquals(record.key, rustStringTargetType()) &&
    rustTargetTypeRefEquals(record.value, rustJsValueTargetType());
}
