import type { RustBlock, RustExpr, RustLocalErrorCapture, RustStmt } from "./nodes.js";

export interface RustLocalControlCapture {
  readonly completionLabel: string;
  readonly errorCapture?: RustLocalErrorCapture;
  readonly completionCaptured?: { value: boolean };
}

export function captureRustLocalControl(
  block: RustBlock,
  capture: RustLocalControlCapture,
): RustBlock {
  return {
    ...block,
    statements: block.statements.map((statement) => captureStatement(statement, capture)),
  };
}

function captureStatement(
  statement: RustStmt,
  capture: RustLocalControlCapture,
): RustStmt {
  switch (statement.kind) {
    case "let":
      return statement.init === undefined
        ? statement
        : { ...statement, init: captureExpression(statement.init, capture) };
    case "let-pattern":
      return { ...statement, init: captureExpression(statement.init, capture) };
    case "expr":
      return { ...statement, expr: captureExpression(statement.expr, capture) };
    case "assign":
      return {
        ...statement,
        target: captureExpression(statement.target, capture),
        value: captureExpression(statement.value, capture),
      };
    case "return":
      return statement.expr === undefined
        ? statement
        : { ...statement, expr: captureExpression(statement.expr, capture) };
    case "tail":
      return { ...statement, expr: captureExpression(statement.expr, capture) };
    case "if":
      return {
        ...statement,
        condition: captureExpression(statement.condition, capture),
        then: captureRustLocalControl(statement.then, capture),
        ...(statement.else === undefined
          ? {}
          : { else: captureRustLocalControl(statement.else, capture) }),
      };
    case "loop":
      return { ...statement, body: captureRustLocalControl(statement.body, capture) };
    case "while":
      return {
        ...statement,
        condition: captureExpression(statement.condition, capture),
        body: captureRustLocalControl(statement.body, capture),
      };
    case "while-let-some":
      return {
        ...statement,
        expression: captureExpression(statement.expression, capture),
        body: captureRustLocalControl(statement.body, capture),
      };
    case "for":
      return {
        ...statement,
        iterable: captureExpression(statement.iterable, capture),
        body: captureRustLocalControl(statement.body, capture),
      };
    case "if-let-some":
      return {
        ...statement,
        expression: captureExpression(statement.expression, capture),
        body: captureRustLocalControl(statement.body, capture),
      };
    case "break":
    case "continue":
      return statement;
    case "completion-exit":
      if (capture.completionCaptured !== undefined) {
        capture.completionCaptured.value = true;
      }
      return {
        ...statement,
        captureLabel: capture.completionLabel,
        ...(statement.expr === undefined
          ? {}
          : { expr: captureExpression(statement.expr, capture) }),
      };
    case "resource-scope":
    case "try-scope":
      if (statement.propagate && capture.completionCaptured !== undefined) {
        capture.completionCaptured.value = true;
      }
      return {
        ...statement,
        ...(statement.propagate ? { propagateLabel: capture.completionLabel } : {}),
        ...(capture.errorCapture === undefined
          ? {}
          : { errorCapture: capture.errorCapture }),
      };
    case "index-assign":
      return {
        ...statement,
        receiver: captureExpression(statement.receiver, capture),
        index: captureExpression(statement.index, capture),
        value: captureExpression(statement.value, capture),
      };
    case "scope":
    case "unsafe-scope":
      return { ...statement, body: captureRustLocalControl(statement.body, capture) };
    case "throw":
      return {
        ...statement,
        ...(capture.errorCapture === undefined ? {} : { errorCapture: capture.errorCapture }),
        error: captureExpression(statement.error, capture),
      };
  }
}

function captureExpression(
  expression: RustExpr,
  capture: RustLocalControlCapture,
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
    case "unreachable":
      return expression;
    case "bottom":
    case "owned-string-from-borrowed-str":
    case "numeric-cast":
    case "unsafe":
      return { ...expression, expression: captureExpression(expression.expression, capture) };
    case "unary":
      return { ...expression, operand: captureExpression(expression.operand, capture) };
    case "dereference":
      return { ...expression, pointer: captureExpression(expression.pointer, capture) };
    case "binary":
      return {
        ...expression,
        left: captureExpression(expression.left, capture),
        right: captureExpression(expression.right, capture),
      };
    case "range":
      return {
        ...expression,
        start: captureExpression(expression.start, capture),
        end: captureExpression(expression.end, capture),
      };
    case "conditional":
      return {
        ...expression,
        condition: captureExpression(expression.condition, capture),
        whenTrue: captureExpression(expression.whenTrue, capture),
        whenFalse: captureExpression(expression.whenFalse, capture),
      };
    case "match":
      return {
        ...expression,
        expression: captureExpression(expression.expression, capture),
        arms: expression.arms.map((arm) => ({
          ...arm,
          expression: captureExpression(arm.expression, capture),
        })),
      };
    case "matches":
      return { ...expression, expression: captureExpression(expression.expression, capture) };
    case "assignment":
      return {
        ...expression,
        target: captureExpression(expression.target, capture),
        value: captureExpression(expression.value, capture),
      };
    case "call":
    case "associated-call":
      return { ...expression, args: expression.args.map((argument) => captureExpression(argument, capture)) };
    case "invoke":
      return {
        ...expression,
        callee: captureExpression(expression.callee, capture),
        args: expression.args.map((argument) => captureExpression(argument, capture)),
      };
    case "method-call":
      return {
        ...expression,
        receiver: captureExpression(expression.receiver, capture),
        args: expression.args.map((argument) => captureExpression(argument, capture)),
      };
    case "field":
    case "tuple-field":
      return { ...expression, receiver: captureExpression(expression.receiver, capture) };
    case "index":
      return {
        ...expression,
        receiver: captureExpression(expression.receiver, capture),
        index: captureExpression(expression.index, capture),
      };
    case "block":
      return {
        ...expression,
        bindings: expression.bindings.map((binding) => ({
          ...binding,
          value: captureExpression(binding.value, capture),
        })),
        value: captureExpression(expression.value, capture),
      };
    case "evaluate-then":
      return {
        ...expression,
        effect: captureExpression(expression.effect, capture),
        value: captureExpression(expression.value, capture),
      };
    case "string-concat":
      return { ...expression, parts: expression.parts.map((part) => captureExpression(part, capture)) };
    case "format-write":
      return {
        ...expression,
        writer: captureExpression(expression.writer, capture),
        args: expression.args.map((argument) => captureExpression(argument, capture)),
      };
    case "reference":
      return { ...expression, expr: captureExpression(expression.expr, capture) };
    case "vec-literal":
    case "slice-literal":
    case "tuple-literal":
      return { ...expression, elements: expression.elements.map((element) => captureExpression(element, capture)) };
    case "closure":
    case "closure-block":
      return expression;
    case "await":
      return { ...expression, expr: captureExpression(expression.expr, capture) };
    case "try":
      return {
        ...expression,
        ...(capture.errorCapture === undefined ? {} : { errorCapture: capture.errorCapture }),
        expr: captureExpression(expression.expr, capture),
      };
    case "return-expression":
      if (capture.completionCaptured !== undefined) {
        capture.completionCaptured.value = true;
      }
      return {
        ...expression,
        captureLabel: capture.completionLabel,
        ...(expression.expr === undefined
          ? {}
          : { expr: captureExpression(expression.expr, capture) }),
      };
    case "struct-literal":
      return {
        ...expression,
        fields: expression.fields.map((field) => ({
          ...field,
          value: captureExpression(field.value, capture),
        })),
        ...(expression.base === undefined
          ? {}
          : { base: captureExpression(expression.base, capture) }),
      };
  }
}
