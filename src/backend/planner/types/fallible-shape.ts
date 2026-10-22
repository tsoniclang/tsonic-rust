import type { RustBlock, RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { mapRustExpressionChildren } from "../../target-ast/syntax/expression-children.js";
import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import type { RustFallibleBoundary } from "../program/fallible-boundaries.js";

export type RustFallibleShapeOptions =
  | {
      readonly fallible: false;
      readonly hasReturnValue: boolean;
    }
  | (Pick<RustFallibleBoundary, "errorType"> & {
      readonly fallible: true;
      readonly hasReturnValue: boolean;
      readonly inferErrorTypeFromReturnType: boolean;
      readonly canFallThrough: boolean;
    });

export function applyRustFallibleResultExpression(
  expression: RustExpr,
  boundary: Pick<RustFallibleBoundary, "errorType">,
): RustExpr {
  return applyRustResultExpression(expression, boundary, false);
}

export function rustEliminateInfallibleResult(
  expression: RustExpr,
  valueName: string,
  errorName: string,
): RustExpr {
  // A block scrutinee is bound first: a match never scrutinizes a block expression.
  const scrutinee: RustExpr = expression.kind === "block" ? { kind: "path", path: valueName } : expression;
  const eliminated: RustExpr = { kind: "match", expression: scrutinee, arms: [
    { pattern: { kind: "tuple-variant", path: "Ok", elements: [{ kind: "binding", name: valueName }] },
      expression: { kind: "path", path: valueName } },
    { pattern: { kind: "tuple-variant", path: "Err", elements: [{ kind: "binding", name: errorName }] },
      expression: { kind: "match", expression: { kind: "path", path: errorName }, arms: [] } },
  ] };
  return expression.kind === "block" ? rustValueBlock([{ name: valueName, value: expression }], eliminated) : eliminated;
}

function applyRustResultExpression(
  expression: RustExpr,
  boundary: Pick<RustFallibleBoundary, "errorType">,
  inferErrorTypeFromReturnType: boolean,
): RustExpr {
  if (expression.kind === "bottom") {
    return expression;
  }
  const propagated = rustPropagatedResult(expression, boundary.errorType);
  if (propagated !== undefined) return propagated;
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

// `Ok(result?)` whose propagated error already has the boundary's error type is `result` itself (or
// `result.map_err(From::from)` when only the operand's error differs); emitting the wrapper fails
// clippy::needless_question_mark.
export function rustPropagatedResult(expression: RustExpr, errorType: RustType): RustExpr | undefined {
  if (expression.kind !== "try" || expression.nativeReturn === true || !rustTypeEquals(expression.resultErrorType, errorType)) return undefined;
  return rustTypeEquals(expression.operandErrorType, errorType) ? expression.expr : {
    kind: "method-call", receiver: expression.expr, method: "map_err",
    args: [{ kind: "associated-value", owner: errorType, name: "from" }],
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
      case "let-pattern": return { ...statement, init: wrapReturns(statement.init) };
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
  if (!options.hasReturnValue && options.canFallThrough) {
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
