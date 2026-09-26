import type {
  RustConstArgument,
  RustExpr,
  RustItem,
  RustLifetime,
  RustPattern,
  RustType,
} from "./nodes.js";

export type RustTokenDelimiter = "parentheses" | "brackets" | "braces";

export type RustTokenFragment =
  | { readonly kind: "expression"; readonly expression: RustExpr }
  | { readonly kind: "type"; readonly type: RustType }
  | { readonly kind: "pattern"; readonly pattern: RustPattern }
  | { readonly kind: "items"; readonly items: readonly RustItem[] }
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetime }
  | { readonly kind: "const"; readonly value: RustConstArgument };

export type RustTokenTree =
  | { readonly kind: "identifier"; readonly text: string; readonly raw: boolean }
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "punctuation"; readonly text: string; readonly joint: boolean }
  | { readonly kind: "group"; readonly delimiter: RustTokenDelimiter; readonly tokens: readonly RustTokenTree[] }
  | { readonly kind: "fragment"; readonly fragment: RustTokenFragment };

export interface RustMacroInput {
  readonly delimiter: RustTokenDelimiter;
  readonly tokens: readonly RustTokenTree[];
}

export function rustSeparatedExpressionTokens(
  expressions: readonly RustExpr[],
  separator: "," | ";",
): readonly RustTokenTree[] {
  const tokens: RustTokenTree[] = [];
  for (const expression of expressions) {
    if (tokens.length > 0) {
      tokens.push(Object.freeze({ kind: "punctuation", text: separator, joint: false }));
    }
    tokens.push(Object.freeze({
      kind: "fragment",
      fragment: Object.freeze({ kind: "expression", expression }),
    }));
  }
  return Object.freeze(tokens);
}

export function rustMacroInputFragments(input: RustMacroInput): readonly RustTokenFragment[] {
  const fragments: RustTokenFragment[] = [];
  const pending = [...input.tokens].reverse();
  while (pending.length > 0) {
    const token = pending.pop()!;
    if (token.kind === "fragment") {
      fragments.push(token.fragment);
    } else if (token.kind === "group") {
      for (let index = token.tokens.length - 1; index >= 0; index -= 1) {
        pending.push(token.tokens[index]!);
      }
    }
  }
  return fragments;
}

export function rustMacroInputExpressions(input: RustMacroInput): readonly RustExpr[] {
  return rustMacroInputFragments(input).flatMap(fragment =>
    fragment.kind === "expression" ? [fragment.expression] : []);
}
