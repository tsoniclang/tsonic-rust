import { hasExactObjectKeys, isMetadataRecord } from "../metadata/closed-data.js";

export type RustCapturedFieldStorageKind = "copy" | "shared" | "cell" | "borrow-cell";

export interface RustCapturedFieldStorage {
  readonly kind: RustCapturedFieldStorageKind;
  readonly initialization: "ready" | "deferred";
}

export function isRustCapturedFieldStorage(value: unknown): value is RustCapturedFieldStorage {
  return isMetadataRecord(value) && hasExactObjectKeys(value, ["kind", "initialization"]) &&
    (value.kind === "copy" && value.initialization === "ready" ||
      value.kind === "shared" || value.kind === "cell" || value.kind === "borrow-cell") &&
    (value.initialization === "ready" || value.initialization === "deferred");
}
