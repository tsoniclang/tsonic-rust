import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "./reader.js";

export interface RustBindingLiveness {
  readonly unused: boolean;
  readonly unusedInitializer: boolean;
  readonly multipleWrites: boolean;
}

export interface RustBindingLivenessRecords {
  readonly bindingLiveness: RustRecordFamily<RustBindingLiveness>;
  readonly unobservedWrite: RustRecordFamily<boolean>;
}

