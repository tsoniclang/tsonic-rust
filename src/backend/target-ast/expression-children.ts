import type { RustBlock, RustExpr } from "./nodes.js";

export function mapRustExpressionChildren(
  expression: RustExpr,
  mapExpression: (expression: RustExpr) => RustExpr,
  mapBlock: (block: RustBlock) => RustBlock,
): RustExpr {
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
    case "unreachable": return expression;
    case "bottom":
    case "owned-string-from-borrowed-str":
    case "numeric-cast":
    case "unsafe":
    case "matches": return { ...expression, expression: mapExpression(expression.expression) };
    case "unary": return { ...expression, operand: mapExpression(expression.operand) };
    case "dereference": return { ...expression, pointer: mapExpression(expression.pointer) };
    case "binary": return { ...expression, left: mapExpression(expression.left), right: mapExpression(expression.right) };
    case "range": return { ...expression, start: mapExpression(expression.start), end: mapExpression(expression.end) };
    case "conditional": return { ...expression, condition: mapExpression(expression.condition),
      whenTrue: mapExpression(expression.whenTrue), whenFalse: mapExpression(expression.whenFalse) };
    case "if-let": return { ...expression, expression: mapExpression(expression.expression),
      whenTrue: mapExpression(expression.whenTrue),
      ...(expression.whenFalse === undefined ? {} : { whenFalse: mapExpression(expression.whenFalse) }) };
    case "match": return { ...expression, expression: mapExpression(expression.expression),
      arms: expression.arms.map(arm => ({ ...arm, expression: mapExpression(arm.expression) })) };
    case "assignment": return { ...expression, target: mapExpression(expression.target), value: mapExpression(expression.value) };
    case "call":
    case "associated-call":
    case "macro-invocation": return { ...expression, args: expression.args.map(mapExpression) };
    case "invoke": return { ...expression, callee: mapExpression(expression.callee), args: expression.args.map(mapExpression) };
    case "method-call": return { ...expression, receiver: mapExpression(expression.receiver), args: expression.args.map(mapExpression) };
    case "option-presence":
    case "field": return { ...expression, receiver: mapExpression(expression.receiver) };
    case "index": return { ...expression, receiver: mapExpression(expression.receiver), index: mapExpression(expression.index) };
    case "block":
    case "closure-block":
    case "async-block": return { ...expression, body: mapBlock(expression.body) };
    case "evaluate-then": return { ...expression, effect: mapExpression(expression.effect), value: mapExpression(expression.value) };
    case "string-concat": return { ...expression, parts: expression.parts.map(mapExpression) };
    case "format-write": return { ...expression, writer: mapExpression(expression.writer), args: expression.args.map(mapExpression) };
    case "reference":
    case "await":
    case "option-try":
    case "try": return { ...expression, expr: mapExpression(expression.expr) };
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal": return { ...expression, elements: expression.elements.map(mapExpression) };
    case "array-repeat": return { ...expression, element: mapExpression(expression.element) };
    case "closure": return { ...expression, body: mapExpression(expression.body) };
    case "return-expression": return expression.expr === undefined
      ? expression : { ...expression, expr: mapExpression(expression.expr) };
    case "struct-literal": return { ...expression,
      fields: expression.fields.map(field => ({ ...field, value: mapExpression(field.value) })),
      ...(expression.base === undefined ? {} : { base: mapExpression(expression.base) }) };
  }
}
