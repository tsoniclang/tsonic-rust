import type { RustRecordFamily } from "./program.js";

export interface RustStatementExitRecords {
  readonly statementExit: RustRecordFamily<boolean>;
}
