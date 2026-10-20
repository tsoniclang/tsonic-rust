import type { Node } from "@tsonic/tsts";

export interface RustNumericRepresentations {
  readonly int32Remainder: { readonly get: (expression: Node) => boolean };
}
