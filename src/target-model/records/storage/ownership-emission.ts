import type { RustRecordFamily } from "../program.js";
import type { RustReadOwnershipFact, RustCaptureReadOwnership } from "./ownership.js";

export interface RustOwnershipEmissionRecords {
  readonly readOwnership: RustRecordFamily<RustReadOwnershipFact>;
  readonly captureOwnership: RustRecordFamily<readonly RustCaptureReadOwnership[]>;
}
