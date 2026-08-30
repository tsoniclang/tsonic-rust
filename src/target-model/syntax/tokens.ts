export type RustPrimitiveTypeName =
  | "bool"
  | "i8"
  | "u8"
  | "i16"
  | "u16"
  | "i32"
  | "u32"
  | "i64"
  | "u64"
  | "i128"
  | "u128"
  | "f32"
  | "f64"
  | "isize"
  | "usize";

export type RustBinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

export type RustAssignmentOperator =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "&="
  | "|="
  | "^="
  | "<<="
  | ">>=";
export type RustOperatorToken = RustBinaryOperator | RustAssignmentOperator | "!";
export type RustOperationSymbol = RustOperatorToken | ">>>" | ">>>=";

export const rustStringPushMethod = "push";
export const rustStringPushStrMethod = "push_str";

export function isRustBinaryOperator(value: RustOperationSymbol): value is RustBinaryOperator {
  return value === "+" || value === "-" || value === "*" || value === "/" || value === "%" ||
    value === "&" || value === "|" || value === "^" || value === "<<" || value === ">>" ||
    value === "<" || value === "<=" || value === ">" || value === ">=" || value === "==" ||
    value === "!=" || value === "&&" || value === "||";
}

export function isRustAssignmentOperator(
  value: RustOperationSymbol,
): value is RustAssignmentOperator {
  return value === "=" || value === "+=" || value === "-=" ||
    value === "*=" || value === "/=" || value === "%=" ||
    value === "&=" || value === "|=" || value === "^=" ||
    value === "<<=" || value === ">>=";
}

export function rustBinaryOperatorTraitPath(operator: RustBinaryOperator): string | undefined {
  switch (operator) {
    case "+":
      return "core::ops::Add";
    case "-":
      return "core::ops::Sub";
    case "*":
      return "core::ops::Mul";
    case "/":
      return "core::ops::Div";
    case "%":
      return "core::ops::Rem";
    case "&":
      return "core::ops::BitAnd";
    case "|":
      return "core::ops::BitOr";
    case "^":
      return "core::ops::BitXor";
    case "<<":
      return "core::ops::Shl";
    case ">>":
      return "core::ops::Shr";
    case "<":
    case "<=":
    case ">":
    case ">=":
      return "core::cmp::PartialOrd";
    case "==":
    case "!=":
      return "core::cmp::PartialEq";
    case "&&":
    case "||":
      return undefined;
  }
}
