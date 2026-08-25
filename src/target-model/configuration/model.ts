import type { RustEdition, RustOutputType } from "../project/model.js";
import type { RustDialect } from "../semantics/index.js";

export type RustProjectConfiguration =
  | { readonly kind: "generated" }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export interface RustTargetConfigurationInput {
  readonly crateName: string;
  readonly edition: RustEdition;
  readonly outputType: RustOutputType;
  readonly project: RustProjectConfiguration;
}

export interface RustTargetConfiguration extends RustTargetConfigurationInput {
  readonly dialect: RustDialect;
}
