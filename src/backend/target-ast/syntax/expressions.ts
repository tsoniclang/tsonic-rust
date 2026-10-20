import type { RustExpr } from "./nodes.js";

export function cloneRustExpression(expression: RustExpr): RustExpr {
  return { kind: "method-call", receiver: expression, receiverMode: "ref", method: "clone", args: [] };
}

export function negateRustBooleanExpression(expression: RustExpr): RustExpr {
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
    : { kind: "call", path: "core::convert::AsRef::<str>::as_ref", args: [{ kind: "reference", expr: part.borrowed ?? part.value }] }) };
}
