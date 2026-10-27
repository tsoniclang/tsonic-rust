import type { RustOperationPolicyContext } from "../../policy/model/operation-context.js";
import type { Node } from "@tsonic/tsts";
import type { RustOperationAttempt } from "./operation-attempts.js";

import type { RustProgramRecordWriter } from "./records/model.js";
import type { RustRequiredRecord } from "./records/objects/required-records.js";
import type { RustSourceStorageResolution } from "../source-evidence/types/resolution/model.js";

export interface RustOperationAnalysisContext extends RustOperationPolicyContext {
  readonly records: RustProgramRecordWriter;
  readonly requiredRecords: RustRequiredRecord[];
  readonly operationAttempts: WeakMap<Node, RustOperationAttempt>;
  readonly sourceStorageResolution: RustSourceStorageResolution;
}
