import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../operations/operations.js";
import type { RustRecordFamily } from "../program.js";

export interface RustUnionCallEmission {
  readonly receiver: Node;
  readonly mutable: boolean;
  readonly fallible: readonly boolean[];
  readonly target: Extract<Extract<RustTargetOperationFact, { readonly kind: "source-call" }>["target"], { readonly form: "union-method" }>;
}

export interface RustUnionCallRecords {
  readonly unionCall: RustRecordFamily<RustUnionCallEmission>;
}
