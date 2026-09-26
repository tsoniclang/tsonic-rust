import type { RustLexicalTokenTree, RustNativeTokenTree, RustTokenSourceRange } from "./token-tree.js";

export interface RustTokenQuotation<Fragment> {
  readonly source: string;
  readonly fragments: readonly {
    readonly source: RustTokenSourceRange;
    readonly fragment: Fragment;
  }[];
}

export function createRustTokenQuotation<Fragment>(
  text: readonly string[],
  fragments: readonly Fragment[],
): RustTokenQuotation<Fragment> {
  if (text.length !== fragments.length + 1) {
    throw new Error("A native token quotation requires one more text segment than source fragments.");
  }
  let source = text[0]!;
  let byteLength = Buffer.byteLength(source, "utf8");
  const bindings: { source: RustTokenSourceRange; fragment: Fragment }[] = [];
  for (let index = 0; index < fragments.length; index += 1) {
    const anchor = `__tsonic_fragment_${index}`;
    const start = byteLength;
    const end = start + anchor.length;
    bindings.push(Object.freeze({ source: Object.freeze({ start, end }), fragment: fragments[index]! }));
    source += anchor + text[index + 1]!;
    byteLength = end + Buffer.byteLength(text[index + 1]!, "utf8");
  }
  return Object.freeze({ source, fragments: Object.freeze(bindings) });
}

export function bindRustTokenQuotation<Fragment>(
  quotation: RustTokenQuotation<Fragment>,
  tokens: readonly RustLexicalTokenTree[],
): readonly RustNativeTokenTree<Fragment>[] {
  const bindings = new Map<number, (typeof quotation.fragments)[number]>();
  const matched = new Set<number>();
  const sourceLength = Buffer.byteLength(quotation.source, "utf8");
  let previousEnd = 0;
  for (const binding of quotation.fragments) {
    const { start, end } = binding.source;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < previousEnd || start >= end ||
        end > sourceLength) {
      throw new Error("Native token quotation has invalid or overlapping fragment ranges.");
    }
    bindings.set(start, binding);
    previousEnd = end;
  }
  const replace = (stream: readonly RustLexicalTokenTree[]): readonly RustNativeTokenTree<Fragment>[] =>
    Object.freeze(stream.map((token): RustNativeTokenTree<Fragment> => {
      if (token.kind === "group") {
        return Object.freeze({ ...token, tokens: replace(token.tokens) });
      }
      const binding = token.source === undefined ? undefined : bindings.get(token.source.start);
      if (binding === undefined) return token;
      if (token.kind !== "identifier" || token.source!.end !== binding.source.end || matched.has(binding.source.start)) {
        throw new Error("A native source fragment must occupy exactly one distinct native identifier token.");
      }
      matched.add(binding.source.start);
      return Object.freeze({ kind: "fragment", fragment: binding.fragment, source: binding.source });
    }));
  const result = replace(tokens);
  if (matched.size !== bindings.size) {
    throw new Error("A native source fragment cannot be embedded in a literal, comment, identifier or punctuation token.");
  }
  return result;
}
