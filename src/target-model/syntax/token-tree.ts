export type RustTokenDelimiter = "parentheses" | "brackets" | "braces";

export interface RustTokenSourceRange {
  readonly start: number;
  readonly end: number;
}

export type RustNativeTokenTree<Fragment> = (
  | { readonly kind: "identifier"; readonly text: string; readonly raw: boolean }
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "punctuation"; readonly text: string; readonly joint: boolean }
  | {
      readonly kind: "group";
      readonly delimiter: RustTokenDelimiter;
      readonly tokens: readonly RustNativeTokenTree<Fragment>[];
    }
  | { readonly kind: "fragment"; readonly fragment: Fragment }
) & { readonly source?: RustTokenSourceRange };

export interface RustNativeMacroInput<Fragment> {
  readonly delimiter: RustTokenDelimiter;
  readonly tokens: readonly RustNativeTokenTree<Fragment>[];
}

export type RustLexicalTokenTree = RustNativeTokenTree<never>;
