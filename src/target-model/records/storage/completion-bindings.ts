import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../program.js";

export interface RustCompletionBinding {
  readonly declaration: Node;
  readonly body: "unused" | "entry" | "nested-output";
  readonly catch: "unused" | "entry" | "nested-output";
  readonly output: "declare" | "assign";
}

export interface RustCompletionBindingRecords {
  readonly completionBindings: RustRecordFamily<readonly RustCompletionBinding[]>;
  readonly completionBindingOwner: RustRecordFamily<Node>;
}
