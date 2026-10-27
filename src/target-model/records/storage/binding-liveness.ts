import type { RustRecordFamily } from "../program.js";
import type { RustConstructionLayer } from "../objects/construction.js";

export interface RustBindingLiveness {
  readonly unused: boolean;
  readonly unusedInitializer: boolean;
  readonly multipleWrites: boolean;
}

export type RustUnobservedWrite =
  | { readonly kind: "lexical"; readonly unobserved: boolean }
  | { readonly kind: "construction"; readonly layers: ReadonlyMap<RustConstructionLayer, boolean> };

export interface RustBindingLivenessRecords {
  readonly bindingLiveness: RustRecordFamily<RustBindingLiveness>;
  readonly unobservedWrite: RustRecordFamily<RustUnobservedWrite>;
}

