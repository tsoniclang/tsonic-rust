import type { AstReader, Node, SourceProviderReferenceInfo } from "@tsonic/tsts";
import { rustTokenFragmentOperation } from "./syntax-intrinsics.js";

export type RustSourceMacroFragment =
  | { readonly kind: "expression"; readonly source: Node }
  | { readonly kind: "type"; readonly source: Node; readonly type: Node }
  | { readonly kind: "items"; readonly source: Node; readonly scope: Node; readonly body: Node };

export type RustSourceMacroFragmentResult =
  | { readonly kind: "available"; readonly fragment: RustSourceMacroFragment }
  | { readonly kind: "rejected"; readonly subject: Node; readonly reason: string };

export function readRustSourceMacroFragment(
  source: Node,
  context: {
    readonly ast: AstReader;
    readonly reference: (expression: Node) => SourceProviderReferenceInfo | undefined;
  },
): RustSourceMacroFragmentResult {
  const { ast } = context;
  const node = parenthesized(source, ast);
  const call = ast.is.IsCallExpression(node) ? ast.as.AsCallExpression(node) : undefined;
  const tagged = ast.is.IsTaggedTemplateExpression(node) ? ast.as.AsTaggedTemplateExpression(node) : undefined;
  const expression = call?.Expression ?? tagged?.Tag ?? node;
  const operation = rustTokenFragmentOperation(context.reference(expression)?.intrinsic);
  if (operation === undefined) return available({ kind: "expression", source });
  if (call === undefined || call.QuestionDotToken !== undefined) {
    return rejected(source, "A native token fragment requires a direct non-optional invocation of its exact intrinsic.");
  }
  const arguments_ = ast.arguments(node);
  const types = ast.typeArguments(node);
  if (operation === "type") {
    const type = types[0];
    return type !== undefined && types.length === 1 && arguments_.length === 0
      ? available({ kind: "type", source, type })
      : rejected(source, "A native type fragment requires exactly one type argument and no value arguments.");
  }
  const input = arguments_[0];
  const scope = input === undefined ? undefined : parenthesized(input, ast);
  const body = scope === undefined ? undefined : ast.body(scope);
  if (types.length !== 0 || arguments_.length !== 1 || scope === undefined ||
      !ast.is.IsArrowFunction(scope) || ast.parameters(scope).length !== 0 ||
      ast.typeParameters(scope).length !== 0 || ast.hasModifierKind(scope, "async") ||
      body === undefined || !ast.is.IsBlock(body)) {
    return rejected(source, "A native item fragment requires one inline synchronous zero-parameter declaration-block arrow and no type arguments.");
  }
  return available({ kind: "items", source, scope, body });
}

function parenthesized(node: Node, ast: AstReader): Node {
  let current = node;
  while (ast.is.IsParenthesizedExpression(current)) {
    const expression = ast.as.AsParenthesizedExpression(current)!.Expression;
    if (expression === undefined) break;
    current = expression;
  }
  return current;
}

function available(fragment: RustSourceMacroFragment): RustSourceMacroFragmentResult {
  return Object.freeze({ kind: "available", fragment: Object.freeze(fragment) });
}

function rejected(subject: Node, reason: string): RustSourceMacroFragmentResult {
  return Object.freeze({ kind: "rejected", subject, reason });
}
