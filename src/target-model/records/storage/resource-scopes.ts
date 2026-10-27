import type { SourceResourceScope } from "@tsonic/target-api/analysis";
import type { RustRecordFamily } from "../program.js";
import type { Node } from "@tsonic/tsts";

export interface RustResourceScopeRecords {
  readonly resourceScope: RustRecordFamily<SourceResourceScope>;
  readonly variableDeclarations: RustRecordFamily<readonly Node[]>;
  readonly resourceContinuationExit: RustRecordFamily<boolean>;
}
