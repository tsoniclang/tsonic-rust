import type { RustExpr } from "../nodes.js";

export function rustLiteralIsNativeDefault(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "string-literal":
    case "str-literal": return expression.value === "";
    case "int-literal": return expression.text === "0";
    case "float-literal": return expression.text === "0" || expression.text === "0.0";
    case "bool-literal": return expression.value === false;
    case "char-literal": return expression.value === "\0";
    case "tuple-literal": return expression.elements.length === 0;
    case "none": return true;
    default: return false;
  }
}

export function rustLiteralMayEvaluateEagerly(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "char-literal":
    case "str-literal":
    case "none": return true;
    case "unary": return rustLiteralMayEvaluateEagerly(expression.operand);
    case "numeric-cast": return rustLiteralMayEvaluateEagerly(expression.expression);
    case "tuple-literal": return expression.elements.every(rustLiteralMayEvaluateEagerly);
    default: return false;
  }
}
