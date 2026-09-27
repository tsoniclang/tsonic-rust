import type { AstReader, Node, SourceIntrinsicDeclarationInfo } from "@tsonic/tsts";
import type { RustLexicalTokenTree, RustNativeMacroInput, RustNativeTokenTree } from "../../target-model/syntax/token-tree.js";
import { bindRustTokenQuotation, createRustTokenQuotation } from "../../target-model/syntax/quotation.js";
import { isRustTokenQuotationDeclaration } from "./syntax-intrinsics.js";
import { readRustSourceMacroFragment, type RustSourceMacroFragment } from "./macro-fragment.js";

export type RustSourceMacroInputResult<Fragment> =
  | { readonly kind: "available"; readonly input: RustNativeMacroInput<Fragment> }
  | { readonly kind: "rejected"; readonly subject: Node; readonly reason: string };

export interface RustSourceMacroInputContext<Fragment> {
  readonly ast: AstReader;
  readonly fragment: (source: RustSourceMacroFragment) => Fragment;
  readonly intrinsic: (tag: Node) => SourceIntrinsicDeclarationInfo | undefined;
  readonly tokenize: (source: string) => readonly RustLexicalTokenTree[];
}

export function readRustSourceMacroInput<Fragment>(
  node: Node,
  context: RustSourceMacroInputContext<Fragment>,
): RustSourceMacroInputResult<Fragment> {
  const { ast } = context;
  if (ast.is.IsTaggedTemplateExpression(node)) return quotation(node, context);
  if (!ast.is.IsCallExpression(node)) return rejected(node, "Native macro input requires a source invocation.");
  const call = ast.as.AsCallExpression(node)!;
  if (call.QuestionDotToken !== undefined || (call.TypeArguments?.Nodes.length ?? 0) !== 0) {
    return rejected(node, "Native macro invocations do not have optional-call or call-type-argument syntax; supply native tokens instead.");
  }
  const arguments_ = ast.arguments(node);
  if (arguments_.some(argument => argument === undefined)) return rejected(node, "Native macro input contains an absent source argument.");
  const sole = arguments_.length === 1 ? arguments_[0] : undefined;
  if (sole !== undefined && ast.is.IsArrayLiteralExpression(sole)) {
    const elements = ast.as.AsArrayLiteralExpression(sole)!.Elements;
    return sequence(sole, ast.elements(sole), ast.listHasTrailingComma(elements), "brackets", context);
  }
  if (sole !== undefined && isQuotation(sole, context)) return quotation(sole, context);
  for (const argument of arguments_) {
    if (argument !== undefined && isQuotation(argument, context)) {
      return rejected(argument, "An exact token quotation supplies the complete native macro input and must be its only argument.");
    }
  }
  return sequence(node, arguments_, ast.listHasTrailingComma(call.Arguments), "parentheses", context);
}

function isQuotation<Fragment>(node: Node, context: RustSourceMacroInputContext<Fragment>): boolean {
  if (!context.ast.is.IsTaggedTemplateExpression(node)) return false;
  const tag = context.ast.as.AsTaggedTemplateExpression(node)!.Tag;
  return tag !== undefined && isRustTokenQuotationDeclaration(context.intrinsic(tag)?.declaration);
}

function sequence<Fragment>(
  subject: Node,
  nodes: readonly (Node | undefined)[],
  trailingComma: boolean,
  delimiter: RustNativeMacroInput<Fragment>["delimiter"],
  context: RustSourceMacroInputContext<Fragment>,
): RustSourceMacroInputResult<Fragment> {
  if (nodes.some(node => node === undefined)) return rejected(subject, "Native macro input contains an absent source element.");
  const tokens: RustNativeTokenTree<Fragment>[] = [];
  for (const [index, node] of nodes.entries()) {
    if (index !== 0) tokens.push(comma);
    if (!context.ast.is.IsOmittedExpression(node)) {
      const selected = readRustSourceMacroFragment(node!, context);
      if (selected.kind === "rejected") return selected;
      tokens.push(Object.freeze({ kind: "fragment", fragment: context.fragment(selected.fragment) }));
    }
  }
  if (trailingComma) tokens.push(comma);
  return available(delimiter, Object.freeze(tokens));
}

function quotation<Fragment>(
  node: Node,
  context: RustSourceMacroInputContext<Fragment>,
): RustSourceMacroInputResult<Fragment> {
  const { ast } = context;
  const tagged = ast.as.AsTaggedTemplateExpression(node)!;
  if (tagged.QuestionDotToken !== undefined || (tagged.TypeArguments?.Nodes.length ?? 0) !== 0) {
    return rejected(node, "Native token quotation has no optional tag or type arguments.");
  }
  const template = tagged.Template;
  if (template === undefined) return rejected(node, "Native token quotation requires template syntax.");
  const text: string[] = [];
  const fragments: Fragment[] = [];
  if (ast.is.IsNoSubstitutionTemplateLiteral(template)) {
    const value = ast.cookedTemplateText(template);
    if (value === undefined) return rejected(template, "Native token quotation contains invalid or unterminated template text.");
    text.push(value);
  } else if (ast.is.IsTemplateExpression(template)) {
    const expression = ast.as.AsTemplateExpression(template)!;
    const head = ast.cookedTemplateText(expression.Head);
    if (head === undefined) return rejected(template, "Native token quotation contains invalid or unterminated template text.");
    text.push(head);
    for (const node of expression.TemplateSpans?.Nodes ?? []) {
      const span = node === undefined || !ast.is.IsTemplateSpan(node) ? undefined : ast.as.AsTemplateSpan(node);
      if (span?.Expression === undefined || span.Literal === undefined) {
        return rejected(template, "Native token quotation requires exact source substitution and literal identities.");
      }
      const tail = ast.cookedTemplateText(span.Literal);
      if (tail === undefined) return rejected(span.Literal, "Native token quotation contains invalid or unterminated template text.");
      text.push(tail);
      const selected = readRustSourceMacroFragment(span.Expression, context);
      if (selected.kind === "rejected") return selected;
      fragments.push(context.fragment(selected.fragment));
    }
  } else {
    return rejected(template, "Native token quotation requires template syntax.");
  }
  const input = createRustTokenQuotation(text, fragments);
  const lexical = context.tokenize(input.source);
  let tokens: readonly RustNativeTokenTree<Fragment>[];
  try {
    tokens = bindRustTokenQuotation(input, lexical);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return rejected(node, error.message);
  }
  const sole = tokens.length === 1 ? tokens[0] : undefined;
  return sole?.kind === "group"
    ? available(sole.delimiter, sole.tokens)
    : available("parentheses", tokens);
}

const comma = Object.freeze({ kind: "punctuation", text: ",", joint: false } as const);

function available<Fragment>(
  delimiter: RustNativeMacroInput<Fragment>["delimiter"],
  tokens: readonly RustNativeTokenTree<Fragment>[],
): RustSourceMacroInputResult<Fragment> {
  return Object.freeze({ kind: "available", input: Object.freeze({ delimiter, tokens }) });
}

function rejected(subject: Node, reason: string): RustSourceMacroInputResult<never> {
  return Object.freeze({ kind: "rejected", subject, reason });
}
