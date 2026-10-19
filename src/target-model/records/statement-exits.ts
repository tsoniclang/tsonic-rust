import type { RustRecordFamily } from "./program.js";

export interface RustStatementExitRecords {
  readonly statementExit: RustRecordFamily<boolean>;
  readonly loopForm: RustRecordFamily<RustLoopForm>;
}

export interface RustLoopForm {
  readonly kind: "conditional" | "unconditional";
  readonly neverFallsThrough: boolean;
}
