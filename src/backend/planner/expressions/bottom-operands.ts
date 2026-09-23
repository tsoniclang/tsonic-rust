import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustSyntheticNameState } from "../names/synthetic.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";

export function propagateRustBottomOperand(
  expression: RustExpr,
  names: RustSyntheticNameState,
): RustExpr {
  if (expression.kind === "bottom") return expression;
  if (expression.kind === "block") {
    const value = propagateRustBottomOperand(expression.value, names);
    return value.kind === "bottom"
      ? { kind: "bottom", expression: { ...expression, value: value.expression } }
      : expression;
  }
  const operands = eagerOperands(expression);
  if (operands === undefined) return expression;
  const prefix: RustExpr[] = [];
  for (const operand of operands) {
    const selected = propagateRustBottomOperand(operand, names);
    if (selected.kind === "bottom") {
      return prefix.length === 0 ? selected : {
        kind: "bottom",
        expression: {
          kind: "block",
          bindings: prefix.map(value => ({ name: allocateRustSyntheticName(names, "_evaluated_argument"), value })),
          value: selected.expression,
        },
      };
    }
    prefix.push(operand);
  }
  return expression;
}

function eagerOperands(expression: RustExpr): readonly RustExpr[] | undefined {
  switch (expression.kind) {
    case "call":
    case "associated-call": return expression.args;
    case "method-call": return [expression.receiver, ...expression.args];
    case "invoke": return [expression.callee, ...expression.args];
    case "tuple-literal":
    case "vec-literal":
    case "slice-literal": return expression.elements;
    case "reference":
    case "try":
    case "option-try": return [expression.expr];
    case "numeric-cast":
    case "owned-string-from-borrowed-str": return [expression.expression];
    case "unary": return [expression.operand];
    case "dereference": return [expression.pointer];
    default: return undefined;
  }
}
