import type { Node } from "@tsonic/tsts";

export type RustSourceCallArgumentEmission =
  | { readonly kind: "value" }
  | { readonly kind: "singleton"; readonly element: Node; readonly later: readonly Node[] };
