import type { RustEdition, RustOutputType } from "../project/model.js";
import type { RustFoundation } from "../foundation/model.js";

export type RustProjectConfiguration =
  | { readonly kind: "generated" }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export interface RustTargetConfiguration {
  readonly crateName: string;
  readonly edition: RustEdition;
  readonly foundation: RustFoundation;
  readonly outputType: RustOutputType;
  readonly project: RustProjectConfiguration;
}
