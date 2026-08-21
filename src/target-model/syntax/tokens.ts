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
      return "std::ops::Add";
    case "-":
      return "std::ops::Sub";
    case "*":
      return "std::ops::Mul";
    case "/":
      return "std::ops::Div";
    case "%":
      return "std::ops::Rem";
    case "&":
      return "std::ops::BitAnd";
    case "|":
      return "std::ops::BitOr";
    case "^":
      return "std::ops::BitXor";
    case "<<":
      return "std::ops::Shl";
    case ">>":
      return "std::ops::Shr";
    case "<":
    case "<=":
    case ">":
    case ">=":
      return "std::cmp::PartialOrd";
    case "==":
    case "!=":
      return "std::cmp::PartialEq";
    case "&&":
    case "||":
      return undefined;
  }
}
