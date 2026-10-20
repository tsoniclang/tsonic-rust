import type { Node } from "@tsonic/tsts";

export interface RustIntegerRangeIndex {
  readonly get: (expression: Node) => boolean;
}
