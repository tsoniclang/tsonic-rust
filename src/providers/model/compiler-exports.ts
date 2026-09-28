export interface RustCompilerExportIdentity {
  readonly id: string;
  readonly name: string;
  readonly targetPath: readonly string[];
}

export type RustCompilerMacroKind = "declarative" | "function" | "attribute" | "derive";

export interface RustCompilerMacroExport extends RustCompilerExportIdentity {
  readonly kind: "macro";
  readonly macroKind: RustCompilerMacroKind;
  readonly helpers: readonly string[];
  readonly canonicalPath?: readonly string[];
}
