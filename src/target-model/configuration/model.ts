import type { RustEdition, RustOutputType } from "../project/model.js";

export type RustProjectConfiguration =
  | { readonly kind: "generated" }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export interface RustTargetConfiguration {
  readonly crateName: string;
  readonly edition: RustEdition;
  readonly outputType: RustOutputType;
  readonly project: RustProjectConfiguration;
}
