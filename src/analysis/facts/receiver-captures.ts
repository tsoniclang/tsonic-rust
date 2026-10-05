import type { TargetTypeRef } from "../../target-model/types/model.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataEquals, hasExactObjectKeys } from "../../target-model/metadata/closed-data.js";

import type { RustCapturedFieldStorage } from "../../target-model/types/field-storage.js";
import { isRustCapturedFieldStorage } from "../../target-model/types/field-storage.js";

export interface RustCapturedFieldStorageFact {
  readonly storage: RustCapturedFieldStorage;
  readonly valueCarrier: TargetTypeRef;
}

export const rustCapturedFieldStorageFactKey = defineRustPlanKey<RustCapturedFieldStorageFact>(
  "capturedFieldStorage", (left, right) => hasExactObjectKeys(left, ["storage", "valueCarrier"]) &&
    hasExactObjectKeys(right, ["storage", "valueCarrier"]) && isRustCapturedFieldStorage(left.storage) &&
    isRustCapturedFieldStorage(right.storage) && left.valueCarrier !== undefined && right.valueCarrier !== undefined &&
    closedMetadataEquals(left.storage, right.storage) &&
    rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier),
);
