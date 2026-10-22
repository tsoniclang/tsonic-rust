import type { RustExpr } from "./nodes.js";

export function cloneRustExpression(expression: RustExpr): RustExpr {
  return { kind: "method-call", receiver: expression, receiverMode: "ref", method: "clone", args: [] };
}

export function negateRustBooleanExpression(expression: RustExpr): RustExpr {
  if (expression.kind === "bool-literal") return { kind: "bool-literal", value: !expression.value };
  if (expression.kind === "unary" && expression.operator === "!") return expression.operand;
  if (expression.kind === "option-presence") return { ...expression, present: !expression.present };
  if (expression.kind === "binary") {
    const inverse = expression.operator === "==" ? "!=" : expression.operator === "!=" ? "==" : undefined;
    if (inverse !== undefined) return { ...expression, operator: inverse };
    if (expression.operator === "&&" || expression.operator === "||") return {
      kind: "binary", operator: expression.operator === "&&" ? "||" : "&&",
      left: negateRustBooleanExpression(expression.left), right: negateRustBooleanExpression(expression.right),
    };
  }
  return { kind: "unary", operator: "!", operand: expression };
}

export type RustStringConcatPart = { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "value"; readonly value: RustExpr; readonly borrowed?: RustExpr };

export function rustStringConcat(parts: readonly RustStringConcatPart[]): RustExpr {
  const normalized: RustStringConcatPart[] = [];
  for (const part of parts) {
    if (part.kind === "literal" && part.value.length === 0) continue;
    const previous = normalized[normalized.length - 1];
    if (part.kind === "literal" && previous?.kind === "literal") normalized[normalized.length - 1] = { kind: "literal", value: previous.value + part.value };
    else normalized.push(part);
  }
  if (normalized.length === 0) return { kind: "string-literal", value: "" };
  if (normalized.length === 1) {
    const value = normalized[0]!;
    return value.kind === "literal" ? { kind: "string-literal", value: value.value } : value.value;
  }
  return { kind: "string-concat", parts: normalized.map(part => part.kind === "literal" ? { kind: "str-literal", value: part.value }
    : rustBorrowedStringView(part.borrowed ?? part.value)) };
}

/** A concatenation only borrows its parts, so an owned String materialized from a borrowed str is read as that str. */
export function rustBorrowedStringView(expression: RustExpr): RustExpr {
  if (expression.kind === "evaluate-then") {
    const value = rustBorrowedStringView(expression.value);
    return value === expression.value ? expression : { ...expression, value };
  }
  return expression.kind === "string-literal" ? { kind: "str-literal", value: expression.value }
    : expression.kind === "owned-string-from-borrowed-str" ? expression.expression : expression;
}

/** The printed operands of a string concatenation: each non-literal part is borrowed as a str. */
export function rustStringConcatenationParts(parts: readonly RustExpr[]): readonly RustExpr[] {
  return parts.map(part => part.kind === "string-literal" || part.kind === "str-literal"
    ? { kind: "str-literal", value: part.value }
    : { kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [{ kind: "reference", expr: part }] });
}

/** Whether a condition prints as a statement block (clippy::blocks_in_conditions). */
export function rustConditionPrintsAsBlock(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "block":
    case "evaluate-then": return true;
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str": return rustConditionPrintsAsBlock(expression.expression);
    case "option-try":
    case "try":
    case "await": return rustConditionPrintsAsBlock(expression.expr);
    default: return false;
  }
}
