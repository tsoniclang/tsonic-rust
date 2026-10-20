import type { Node } from "@tsonic/tsts";

import type { RustBorrowedFieldWrite } from "./ownership.js";

export interface RustBorrowEffects {
  readonly pureValues: ReadonlySet<Node>;
  readonly fieldWrites: ReadonlyMap<Node, RustBorrowedFieldWrite>;
  readonly stableBindings: ReadonlySet<Node>;
  readonly nativeWrites: ReadonlyMap<Node, readonly Node[]>;
}
