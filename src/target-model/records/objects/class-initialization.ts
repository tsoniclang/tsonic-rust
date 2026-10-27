import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export type RustClassInitializationEntry =
  | { readonly kind: "block"; readonly declaration: Node; readonly body: Node }
  | { readonly kind: "field"; readonly declaration: Node; readonly initializer: Node; readonly carrier: TargetTypeRef; readonly name: string };

export interface RustStaticFieldStorageSelection {
  readonly copy: boolean;
  readonly environment: { readonly declaration: Node; readonly name: string; readonly readonly: boolean } | undefined;
}
