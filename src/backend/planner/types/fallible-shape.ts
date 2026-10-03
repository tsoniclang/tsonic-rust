import type {
  RustBlock,
  RustExpr,
  RustStmt,
  RustType,
} from "../../target-ast/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import { rustBlockTerminates } from "../statements/block-flow.js";
import { rustStatementExpressions } from "../../target-ast/inspection/source-usage.js";
import { mapRustExpressionChildren } from "../../target-ast/expression-children.js";

export interface RustFallibleBoundary {
  readonly errorType: RustType;
}

export type RustFallibleShapeOptions =
  | {
      readonly fallible: false;
      readonly hasReturnValue: boolean;
    }
  | (RustFallibleBoundary & {
      readonly fallible: true;
      readonly hasReturnValue: boolean;
      readonly inferErrorTypeFromReturnType: boolean;
    });

export function rustExpressionUsesTryInCurrentRegion(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "try":
      return expression.nativeReturn !== true || rustExpressionUsesTryInCurrentRegion(expression.expr);
    case "option-try":
      return rustExpressionUsesTryInCurrentRegion(expression.expr);
    case "bottom":
      return rustExpressionUsesTryInCurrentRegion(expression.expression);
    case "owned-string-from-borrowed-str":
      return rustExpressionUsesTryInCurrentRegion(expression.expression);
    case "unary":
      return rustExpressionUsesTryInCurrentRegion(expression.operand);
    case "dereference":
      return rustExpressionUsesTryInCurrentRegion(expression.pointer);
    case "numeric-cast":
      return rustExpressionUsesTryInCurrentRegion(expression.expression);
    case "binary":
      return rustExpressionUsesTryInCurrentRegion(expression.left) ||
        rustExpressionUsesTryInCurrentRegion(expression.right);
    case "range":
      return rustExpressionUsesTryInCurrentRegion(expression.start) ||
        rustExpressionUsesTryInCurrentRegion(expression.end);
    case "conditional":
      return rustExpressionUsesTryInCurrentRegion(expression.condition) ||
        rustExpressionUsesTryInCurrentRegion(expression.whenTrue) ||
        rustExpressionUsesTryInCurrentRegion(expression.whenFalse);
    case "if-let":
      return rustExpressionUsesTryInCurrentRegion(expression.expression) ||
        rustExpressionUsesTryInCurrentRegion(expression.whenTrue) ||
        expression.whenFalse !== undefined && rustExpressionUsesTryInCurrentRegion(expression.whenFalse);
    case "match":
      return rustExpressionUsesTryInCurrentRegion(expression.expression) ||
        expression.arms.some((arm) => rustExpressionUsesTryInCurrentRegion(arm.expression));
    case "matches":
      return rustExpressionUsesTryInCurrentRegion(expression.expression);
    case "assignment":
      return rustExpressionUsesTryInCurrentRegion(expression.target) ||
        rustExpressionUsesTryInCurrentRegion(expression.value);
    case "macro-invocation":
      return expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "call":
    case "associated-call":
      return expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "invoke":
      return rustExpressionUsesTryInCurrentRegion(expression.callee) ||
        expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "method-call":
      return rustExpressionUsesTryInCurrentRegion(expression.receiver) ||
        expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "option-presence":
    case "field":
      return rustExpressionUsesTryInCurrentRegion(expression.receiver);
    case "index":
      return rustExpressionUsesTryInCurrentRegion(expression.receiver) ||
        rustExpressionUsesTryInCurrentRegion(expression.index);
    case "block":
      return expression.body.statements.flatMap(rustStatementExpressions).some(rustExpressionUsesTryInCurrentRegion);
    case "unsafe":
      return rustExpressionUsesTryInCurrentRegion(expression.expression);
    case "evaluate-then":
      return rustExpressionUsesTryInCurrentRegion(expression.effect) ||
        rustExpressionUsesTryInCurrentRegion(expression.value);
    case "string-concat":
      return expression.parts.some(rustExpressionUsesTryInCurrentRegion);
    case "format-write":
      return rustExpressionUsesTryInCurrentRegion(expression.writer) ||
        expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "reference":
      return rustExpressionUsesTryInCurrentRegion(expression.expr);
    case "vec-literal":
    case "slice-literal":
      return expression.elements.some(rustExpressionUsesTryInCurrentRegion);
    case "array-repeat":
      return rustExpressionUsesTryInCurrentRegion(expression.element);
    case "await":
      return rustExpressionUsesTryInCurrentRegion(expression.expr);
    case "return-expression":
      return expression.expr !== undefined && rustExpressionUsesTryInCurrentRegion(expression.expr);
    case "struct-literal":
      return expression.fields.some((field) =>
        rustExpressionUsesTryInCurrentRegion(field.value)) ||
        (expression.base !== undefined &&
          rustExpressionUsesTryInCurrentRegion(expression.base));
    case "tuple-literal":
      return expression.elements.some(rustExpressionUsesTryInCurrentRegion);
    case "closure":
    case "closure-block":
    case "async-block":
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
      return false;
  }
}

export function applyRustFallibleResultExpression(
  expression: RustExpr,
  boundary: RustFallibleBoundary,
): RustExpr {
  return applyRustResultExpression(expression, boundary, false);
}

function applyRustResultExpression(
  expression: RustExpr,
  boundary: RustFallibleBoundary,
  inferErrorTypeFromReturnType: boolean,
): RustExpr {
  if (expression.kind === "bottom") {
    return expression;
  }
  if (expression.kind === "try" && expression.nativeReturn !== true &&
    rustTypeEquals(expression.resultErrorType, boundary.errorType)) {
    if (rustTypeEquals(expression.operandErrorType, boundary.errorType)) {
      return expression.expr;
    }
    return {
      kind: "method-call",
      receiver: expression.expr,
      method: "map_err",
      args: [{
        kind: "associated-value",
        owner: boundary.errorType,
        name: "from",
      }],
    };
  }
  return {
    kind: "call",
    path: "Ok",
    ...(inferErrorTypeFromReturnType
      ? {}
      : {
          genericArguments: [
            { kind: "type" as const, type: { kind: "infer" as const } },
            { kind: "type" as const, type: boundary.errorType },
          ],
        }),
    args: [expression],
  };
}

export function rustBottomExpression(expression: RustExpr): RustExpr {
  return expression.kind === "bottom" ? expression : { kind: "bottom", expression };
}

export function rustBottomAfterEffect(effect: RustExpr, message: string): RustExpr {
  return rustBottomExpression({
    kind: "evaluate-then",
    effect,
    discard: "unit",
    value: { kind: "unreachable", message },
  });
}

export function applyFallibleShape(
  body: RustBlock,
  options: RustFallibleShapeOptions,
): RustBlock {
  if (!options.fallible) {
    return body;
  }
  const result = (expression: RustExpr): RustExpr => {
    if (!options.hasReturnValue && expression.kind !== "bottom" &&
      !(expression.kind === "path" && expression.path === "()")) {
      return { kind: "evaluate-then", effect: expression, discard: "unit",
        value: applyRustResultExpression({ kind: "path", path: "()" }, options, options.inferErrorTypeFromReturnType) };
    }
    return applyRustResultExpression(expression, options, options.inferErrorTypeFromReturnType);
  };
  const wrap = (statement: RustStmt, wrapTail = true): RustStmt => {
    switch (statement.kind) {
      case "return": return { ...statement,
        expr: result(statement.expr === undefined ? { kind: "path", path: "()" } : wrapReturns(statement.expr)) };
      case "tail": return { ...statement,
        expr: wrapTail ? result(wrapReturns(statement.expr)) : wrapReturns(statement.expr) };
      case "let": return statement.init === undefined ? statement : { ...statement, init: wrapReturns(statement.init) };
      case "expr": return { ...statement, expr: wrapReturns(statement.expr) };
      case "assign": return { ...statement, target: wrapReturns(statement.target), value: wrapReturns(statement.value) };
      case "index-assign": return { ...statement, receiver: wrapReturns(statement.receiver),
        index: wrapReturns(statement.index), value: wrapReturns(statement.value) };
      case "if": return { ...statement, condition: wrapReturns(statement.condition),
        then: wrapBlock(statement.then, wrapTail),
        ...(statement.else === undefined ? {} : { else: wrapBlock(statement.else, wrapTail) }) };
      case "scope":
      case "unsafe-scope": return { ...statement, body: wrapBlock(statement.body, wrapTail) };
      case "while": return { ...statement, condition: wrapReturns(statement.condition), body: wrapBlock(statement.body, false) };
      case "while-let-some": return { ...statement, expression: wrapReturns(statement.expression), body: wrapBlock(statement.body, false) };
      case "for": return { ...statement, iterable: wrapReturns(statement.iterable), body: wrapBlock(statement.body, false) };
      case "loop": return { ...statement, body: wrapBlock(statement.body, false) };
      case "completion-exit":
      case "resource-scope":
      case "try-scope":
      case "throw":
      case "break":
      case "continue":
      case "item": return statement;
    }
  };
  const wrapped = body.statements.map(statement => wrap(statement));
  if (!options.hasReturnValue && !rustBlockTerminates({ statements: wrapped })) {
    wrapped.push({ kind: "tail", expr: result({ kind: "path", path: "()" }) });
  }
  return { ...body, statements: wrapped };

  function wrapBlock(block: RustBlock, wrapTail: boolean): RustBlock {
    return { ...block, statements: block.statements.map(statement => wrap(statement, wrapTail)) };
  }

  function wrapReturns(expression: RustExpr): RustExpr {
    if (expression.kind === "closure" || expression.kind === "closure-block" || expression.kind === "async-block") {
      return expression;
    }
    if (expression.kind === "return-expression") {
      return { ...expression,
        expr: result(expression.expr === undefined ? { kind: "path", path: "()" } : wrapReturns(expression.expr)) };
    }
    return mapRustExpressionChildren(expression, wrapReturns, block => wrapBlock(block, false));
  }
}
