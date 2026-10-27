import type { RustRecordFamily } from "../program.js";

export interface RustArgumentView {
  readonly slice: boolean;
  readonly borrowedStorage: "plain" | "borrow-guard" | undefined;
}

export interface RustArgumentViewRecords {
  readonly argumentView: RustRecordFamily<RustArgumentView>;
}
