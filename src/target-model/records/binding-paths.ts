import type { Node } from "@tsonic/tsts";

export type RustSourceBindingEmission =
  | { readonly scope: "lexical"; readonly name: string }
  | { readonly scope: "module"; readonly name: string; readonly fileName: string };

export interface RustSourceBindingEmissionRecords {
  readonly sourceBindingEmission: { readonly get: (declaration: Node) => RustSourceBindingEmission | undefined };
}
