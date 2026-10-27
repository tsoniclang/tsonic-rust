import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../program.js";

export interface RustExpressionExit {
  readonly prefix: readonly Node[];
  readonly terminal: Node;
}

export interface RustExpressionExitRecords {
  readonly expressionExit: RustRecordFamily<RustExpressionExit>;
}
