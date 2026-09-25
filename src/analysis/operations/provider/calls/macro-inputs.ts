import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";

export function rustSelectedFormatLiteral(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
): string | undefined {
  const first = request.source.sourceArguments[0]?.expression;
  if (first === undefined || !(context.ast.is.IsStringLiteral(first) ||
    context.ast.kindName(first) === "KindNoSubstitutionTemplateLiteral")) return undefined;
  const value = context.ast.text(first);
  return rustFormatHasExplicitArguments(value) ? value : undefined;
}

export function rustFormatHasExplicitArguments(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "{") continue;
    if (value[index + 1] === "{") { index += 1; continue; }
    const end = value.indexOf("}", index + 1);
    if (end < 0) return true;
    const placeholder = value.slice(index + 1, end);
    const separator = placeholder.indexOf(":");
    const position = separator < 0 ? placeholder : placeholder.slice(0, separator);
    if (!/^[0-9]*$/u.test(position)) return false;
    const specification = separator < 0 ? "" : placeholder.slice(separator + 1);
    if (/[\p{ID_Start}_][\p{ID_Continue}]*\$/u.test(specification)) return false;
    index = end;
  }
  return true;
}
