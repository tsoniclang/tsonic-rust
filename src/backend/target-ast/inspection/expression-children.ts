import type { RustExpr } from "../nodes.js";
import { rustMacroInputExpressions } from "../macro-input.js";

export function rustExpressionChildren(expression: RustExpr): readonly RustExpr[] {
  switch (expression.kind) {
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
    case "char-literal":
    case "string-literal":
    case "str-literal":
    case "path":
    case "associated-value":
    case "unreachable":
    case "closure-block":
      return [];
    case "bottom":
    case "numeric-cast":
    case "unsafe":
    case "owned-string-from-borrowed-str":
      return [expression.expression];
    case "unary":
      return [expression.operand];
    case "dereference":
      return [expression.pointer];
    case "binary":
      return [expression.left, expression.right];
    case "range":
      return [expression.start, expression.end];
    case "conditional":
      return [expression.condition, expression.whenTrue, expression.whenFalse];
    case "match":
      return [expression.expression, ...expression.arms.map((arm) => arm.expression)];
    case "matches":
      return [expression.expression];
    case "assignment":
      return [expression.target, expression.value];
    case "call":
    case "associated-call":
      return expression.args;
    case "invoke":
      return [expression.callee, ...expression.args];
    case "method-call":
      return [expression.receiver, ...expression.args];
    case "macro-invocation":
      return rustMacroInputExpressions(expression.input);
    case "option-presence":
    case "field":
      return [expression.receiver];
    case "index":
      return [expression.receiver, expression.index];
    case "block":
      return [...expression.bindings.flatMap((binding) => binding.value === undefined ? [] : [binding.value]), expression.value];
    case "evaluate-then":
      return [expression.effect, expression.value];
    case "string-concat":
      return expression.parts;
    case "format-write":
      return [expression.writer, ...expression.args];
    case "reference":
      return [expression.expr];
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return expression.elements;
    case "array-repeat":
      return expression.length.kind === "path"
        ? [expression.element, { kind: "path", path: expression.length.path }]
        : [expression.element];
    case "closure":
      return [expression.body];
    case "await":
    case "option-try":
    case "try":
      return [expression.expr];
    case "return-expression":
      return expression.expr === undefined ? [] : [expression.expr];
    case "struct-literal":
      return [
        ...expression.fields.map((field) => field.value),
        ...(expression.base === undefined ? [] : [expression.base]),
      ];
  }
}
