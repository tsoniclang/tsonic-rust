import type { RustProgramRecords, RustRecordFamily } from "./program.js";

import type { RustRawLocationPlan } from "./native-memory.js";
import type { RustMemoryBindingPlan } from "./memory-bindings.js";
import type { RustRawAddressPlan } from "./raw-addresses.js";
import type { RustTypedLocationPlan } from "./operations.js";

export interface RustMemoryLayoutObservationFact {
  readonly value: bigint;
}

export interface RustAnalysisRecords extends RustProgramRecords {
  readonly rawLocationPlan: RustRecordFamily<RustRawLocationPlan>;
  readonly memoryBindingPlan: RustRecordFamily<RustMemoryBindingPlan>;
  readonly rawAddressPlan: RustRecordFamily<RustRawAddressPlan>;
  readonly memoryLayoutObservation: RustRecordFamily<RustMemoryLayoutObservationFact>;
  readonly typedLocationPlan: RustRecordFamily<RustTypedLocationPlan>;
}
