import type {
  RustBlock,
  RustErrorDomain,
  RustExpr,
  RustStmt,
} from "../../rust-ast/nodes.js";
import { rustBlockTerminates } from "../statements/block-flow.js";

export interface RustFallibleBoundary {
  readonly errorDomain: RustErrorDomain;
  readonly errorTypePath?: string;
}

export interface RustFallibleShapeOptions extends RustFallibleBoundary {
  readonly fallible: boolean;
  readonly hasReturnValue: boolean;
}

export function rustExpressionUsesTryInCurrentRegion(expression: RustExpr): boolean {
  switch (expression.kind) {
    case "try":
      return true;
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
    case "match":
      return rustExpressionUsesTryInCurrentRegion(expression.expression) ||
        expression.arms.some((arm) => rustExpressionUsesTryInCurrentRegion(arm.expression));
    case "matches":
      return rustExpressionUsesTryInCurrentRegion(expression.expression);
    case "assignment":
      return rustExpressionUsesTryInCurrentRegion(expression.target) ||
        rustExpressionUsesTryInCurrentRegion(expression.value);
    case "call":
    case "associated-call":
      return expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "invoke":
      return rustExpressionUsesTryInCurrentRegion(expression.callee) ||
        expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "method-call":
      return rustExpressionUsesTryInCurrentRegion(expression.receiver) ||
        expression.args.some(rustExpressionUsesTryInCurrentRegion);
    case "field":
      return rustExpressionUsesTryInCurrentRegion(expression.receiver);
    case "index":
      return rustExpressionUsesTryInCurrentRegion(expression.receiver) ||
        rustExpressionUsesTryInCurrentRegion(expression.index);
    case "block":
      return expression.bindings.some((binding) =>
        rustExpressionUsesTryInCurrentRegion(binding.value)) ||
        rustExpressionUsesTryInCurrentRegion(expression.value);
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
    case "await":
      return rustExpressionUsesTryInCurrentRegion(expression.expr);
    case "return-expression":
      return expression.expr !== undefined && rustExpressionUsesTryInCurrentRegion(expression.expr);
    case "struct-literal":
      return expression.fields.some((field) => rustExpressionUsesTryInCurrentRegion(field.value));
    case "tuple-literal":
      return expression.elements.some(rustExpressionUsesTryInCurrentRegion);
    case "closure":
    case "closure-block":
    case "int-literal":
    case "float-literal":
    case "bool-literal":
    case "none":
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
  if (expression.kind === "bottom") {
    return expression;
  }
  if (expression.kind === "try" && expression.errorDomain === boundary.errorDomain) {
    return expression.expr;
  }
  return {
    kind: "call",
    path: boundary.errorTypePath === undefined ? "Ok" : `Ok::<_, ${boundary.errorTypePath}>`,
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
  const wrap = (statement: RustStmt): RustStmt => {
    if (statement.kind === "return" && statement.expr !== undefined) {
      return {
        kind: "return",
        expr: applyRustFallibleResultExpression(statement.expr, {
          errorDomain: options.errorDomain,
          ...(options.errorTypePath === undefined ? {} : { errorTypePath: options.errorTypePath }),
        }),
      };
    }
    if (statement.kind === "return") {
      return {
        kind: "return",
        expr: applyRustFallibleResultExpression(
          { kind: "path", path: "()" },
          options,
        ),
      };
    }
    if (statement.kind === "tail") {
      return {
        kind: "tail",
        expr: applyRustFallibleResultExpression(statement.expr, {
          errorDomain: options.errorDomain,
          ...(options.errorTypePath === undefined ? {} : { errorTypePath: options.errorTypePath }),
        }),
      };
    }
    if (statement.kind === "if") {
      return {
        ...statement,
        then: { statements: statement.then.statements.map(wrap) },
        ...(statement.else === undefined ? {} : { else: { statements: statement.else.statements.map(wrap) } }),
      };
    }
    if (statement.kind === "loop" || statement.kind === "while" || statement.kind === "for" ||
      statement.kind === "while-let-some" || statement.kind === "if-let-some") {
      return { ...statement, body: { statements: statement.body.statements.map(wrap) } };
    }
    if (statement.kind === "scope" || statement.kind === "unsafe-scope") {
      return { ...statement, body: { statements: statement.body.statements.map(wrap) } };
    }
    if (statement.kind === "try-scope") {
      return statement;
    }
    return statement;
  };
  const wrapped = body.statements.map(wrap);
  if (!options.hasReturnValue && !rustBlockTerminates({ statements: wrapped })) {
    wrapped.push({
      kind: "tail",
      expr: applyRustFallibleResultExpression(
        { kind: "path", path: "()" },
        options,
      ),
    });
  }
  return { ...body, statements: wrapped };
}
