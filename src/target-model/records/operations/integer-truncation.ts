import type { TargetTypeRef } from "../../types/model.js";
import type { RustRecordFamily } from "../program.js";

export interface RustIntegerTruncationEmission {
  readonly target: TargetTypeRef;
  readonly path: "js_abi::bigint_as_int_native" | "js_abi::bigint_as_uint_native";
}

export interface RustIntegerTruncationRecords {
  readonly integerTruncation: RustRecordFamily<RustIntegerTruncationEmission>;
}
