import { rustCapturedFieldStorageEquals } from "../../../../target-model/records/equality.js";
import { defineRustPlanKey } from "../key.js";
import type { RustCapturedFieldStorageFact } from "../../../../target-model/records/receiver-captures.js";

export const rustCapturedFieldStorageFactKey = defineRustPlanKey<RustCapturedFieldStorageFact>(
  "capturedFieldStorage", rustCapturedFieldStorageEquals,
);
