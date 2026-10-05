import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import type { RustCapturedFieldStorage } from "../../target-model/types/field-storage.js";

export function selectRustCapturedFieldStorage(carrier: TargetTypeRef, readonly: boolean, deferred: boolean): RustCapturedFieldStorage {
  return Object.freeze({ kind: readonly ? "shared" : isRustCopyCarrier(carrier) ? "cell" : "borrow-cell",
    initialization: deferred ? "deferred" : "ready" });
}
