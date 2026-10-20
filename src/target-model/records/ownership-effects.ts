import type { Node } from "@tsonic/tsts";

import type { RustTargetOperationFact } from "./operations.js";

type StoredField = Extract<RustTargetOperationFact, { readonly kind: "source-field" }>;

import type { RustBorrowedFieldWrite } from "./ownership.js";

export interface RustBorrowEffects {
  readonly pureValues: ReadonlySet<Node>;
  readonly fieldWrites: ReadonlyMap<Node, RustBorrowedFieldWrite>;
  readonly stableBindings: ReadonlySet<Node>;
  readonly nativeWrites: ReadonlyMap<Node, readonly Node[]>;
}
