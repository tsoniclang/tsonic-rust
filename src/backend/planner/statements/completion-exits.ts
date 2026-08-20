import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustReturnExit(
  expression: RustExpr | undefined,
  context: RustPlanContext,
  rootResultWrapped = false,
): RustStmt {
  if (expression?.kind === "bottom") {
    return { kind: "expr", expr: expression };
  }
  const boundary = context.completionBoundary;
  if (boundary === undefined) {
    if (!rootResultWrapped) {
      return { kind: "return", ...(expression === undefined ? {} : { expr: expression }) };
    }
    return {
      kind: "return",
      expr: {
        kind: "call",
        path: "Ok",
        args: [expression ?? { kind: "path", path: "()" }],
      },
    };
  }
  markOutermostReturnDispatch(boundary);
  context.usedAliases?.add("rt");
  return {
    kind: "completion-exit",
    completion: "return",
    resultWrapped: boundary.fallible,
    ...(expression === undefined ? {} : { expr: expression }),
  };
}

export function planRustFallibleReturnExpression(
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr {
  if (expression.kind === "bottom") {
    return expression;
  }
  const boundary = context.completionBoundary;
  if (boundary === undefined) {
    return {
      kind: "return-expression",
      expr: { kind: "call", path: "Ok", args: [expression] },
    };
  }
  markOutermostReturnDispatch(boundary);
  context.usedAliases?.add("rt");
  const completion: RustExpr = {
    kind: "call",
    path: "rt::Completion::Return",
    args: [expression],
  };
  return {
    kind: "return-expression",
    expr: boundary.fallible
      ? { kind: "call", path: "Ok", args: [completion] }
      : completion,
  };
}

function markOutermostReturnDispatch(
  boundary: NonNullable<RustPlanContext["completionBoundary"]>,
): void {
  let outermost = boundary;
  while (outermost.parent !== undefined) {
    outermost = outermost.parent;
  }
  outermost.dispatchReturn.value = true;
}
