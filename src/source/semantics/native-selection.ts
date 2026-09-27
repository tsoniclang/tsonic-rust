import type { AstReader, Node, SourceProviderReferenceInfo } from "@tsonic/tsts";
import { rustNativeSelectionOperation } from "./syntax-intrinsics.js";

export type RustSourceProviderSelection =
  | { readonly kind: "unavailable" }
  | { readonly kind: "ambiguous"; readonly reference: SourceProviderReferenceInfo }
  | (Pick<SourceProviderReferenceInfo, "expression" | "symbol"> & (
    | { readonly kind: "intrinsic"; readonly intrinsic: NonNullable<SourceProviderReferenceInfo["intrinsic"]> }
    | { readonly kind: "ordinary"; readonly ordinary: NonNullable<SourceProviderReferenceInfo["ordinary"]> }
  ))
  | { readonly kind: "rejected"; readonly subject: Node; readonly reason: string };

export function readRustSourceProviderSelection(
  source: Node,
  context: {
    readonly ast: AstReader;
    readonly reference: (expression: Node) => SourceProviderReferenceInfo | undefined;
  },
): RustSourceProviderSelection {
  const { ast } = context;
  let expression = source;
  while (ast.is.IsParenthesizedExpression(expression)) {
    const inner = ast.as.AsParenthesizedExpression(expression)!.Expression;
    if (inner === undefined) return rejected(source, "A native namespace selection requires its complete source expression.");
    expression = inner;
  }
  const call = ast.is.IsCallExpression(expression) ? ast.as.AsCallExpression(expression) : undefined;
  const tagged = ast.is.IsTaggedTemplateExpression(expression) ? ast.as.AsTaggedTemplateExpression(expression) : undefined;
  const operation = rustNativeSelectionOperation(context.reference(call?.Expression ?? tagged?.Tag ?? expression)?.intrinsic);
  if (operation === undefined) return select(context.reference(expression));
  const arguments_ = ast.arguments(expression);
  const binding = arguments_[0];
  if (call === undefined || call.QuestionDotToken !== undefined || ast.typeArguments(expression).length !== 0 ||
      arguments_.length !== 1 || binding === undefined) {
    return rejected(source, "A native namespace selection requires exactly one direct binding, no type arguments and no optional call.");
  }
  const reference = context.reference(binding);
  if (reference === undefined) return rejected(binding, "A native namespace selection requires an exact static provider binding.");
  if (operation === "macro") {
    return reference.intrinsic === undefined
      ? rejected(binding, "The selected provider binding has no intrinsic facet.")
      : Object.freeze({ kind: "intrinsic", expression: reference.expression, symbol: reference.symbol, intrinsic: reference.intrinsic });
  }
  return reference.ordinary === undefined
    ? rejected(binding, "The selected provider binding has no ordinary facet.")
    : Object.freeze({ kind: "ordinary", expression: reference.expression, symbol: reference.symbol, ordinary: reference.ordinary });
}

function select(reference: SourceProviderReferenceInfo | undefined): RustSourceProviderSelection {
  if (reference === undefined) return Object.freeze({ kind: "unavailable" });
  if (reference.intrinsic !== undefined && reference.ordinary !== undefined) return Object.freeze({ kind: "ambiguous", reference });
  if (reference.intrinsic !== undefined) return Object.freeze({ kind: "intrinsic", expression: reference.expression, symbol: reference.symbol, intrinsic: reference.intrinsic });
  return Object.freeze({ kind: "ordinary", expression: reference.expression, symbol: reference.symbol, ordinary: reference.ordinary });
}

function rejected(subject: Node, reason: string): RustSourceProviderSelection {
  return Object.freeze({ kind: "rejected", subject, reason });
}
