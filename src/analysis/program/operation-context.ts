import type { RustOperationPolicyContext } from "../../policy/model/operation-context.js";


import type { RustProgramRecordWriter } from "./records/model.js";

export interface RustOperationAnalysisContext extends RustOperationPolicyContext {
  readonly records: RustProgramRecordWriter;
}
