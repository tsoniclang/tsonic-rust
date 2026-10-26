import type { RustOperationPolicyContext } from "../../policy/model/operation-context.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationAttempt } from "./operation-attempts.js";

import type { RustProgramRecordWriter } from "./records/model.js";
import type { RustRequiredRecord } from "./records/required-records.js";

export interface RustOperationAnalysisContext extends RustOperationPolicyContext {
  readonly records: RustProgramRecordWriter;
  readonly requiredRecords: RustRequiredRecord[];
  readonly operationAttempts: WeakMap<Node, RustOperationAttempt>;
}
