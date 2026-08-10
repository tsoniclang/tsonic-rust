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
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

export type RustAssignmentOperator = "=" | "+=" | "-=" | "*=" | "/=" | "%=";
export type RustOperatorToken = RustBinaryOperator | RustAssignmentOperator | "!";

export function isRustBinaryOperator(value: RustOperatorToken): value is RustBinaryOperator {
  return value === "+" || value === "-" || value === "*" || value === "/" || value === "%" ||
    value === "<" || value === "<=" || value === ">" || value === ">=" || value === "==" ||
    value === "!=" || value === "&&" || value === "||";
}

export function isRustAssignmentOperator(
  value: RustOperatorToken,
): value is RustAssignmentOperator {
  return value === "=" || value === "+=" || value === "-=" ||
    value === "*=" || value === "/=" || value === "%=";
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
