import type { Node } from "@tsonic/tsts";

export interface RustSourceNameRecords {
  readonly sourceName: { readonly get: (declaration: Node | undefined) => string | undefined };
}
