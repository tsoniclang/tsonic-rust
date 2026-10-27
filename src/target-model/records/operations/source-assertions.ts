import type { Node } from "@tsonic/tsts";
import type { RustValueConversion } from "../../operations/model.js";
import type { RustRecordFamily } from "../program.js";

export interface RustSourceAssertionEmission {
  readonly operand: Node;
  readonly borrowed: boolean;
  readonly conversion: RustValueConversion | undefined;
}

export interface RustSourceAssertionRecords {
  readonly sourceAssertion: RustRecordFamily<RustSourceAssertionEmission>;
}
