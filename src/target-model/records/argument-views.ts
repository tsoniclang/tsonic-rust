import type { RustRecordFamily } from "./program.js";

export interface RustArgumentView {
  readonly slice: boolean;
  readonly borrowedStorage: boolean;
}

export interface RustArgumentViewRecords {
  readonly argumentView: RustRecordFamily<RustArgumentView>;
}
