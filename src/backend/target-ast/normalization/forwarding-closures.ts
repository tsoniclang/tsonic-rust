import type { RustExpr } from "../nodes.js";

export function collapseRustForwardingClosure(expression: RustExpr): RustExpr {
  if (expression.kind !== "closure" || expression.body.kind !== "call" ||
    expression.params.some(parameter => parameter.byRefCopy) ||
    expression.params.length !== expression.body.args.length) return expression;
  const call = expression.body;
  if (expression.params.some(parameter => parameter.name === call.path) ||
    !call.args.every((argument, index) => argument.kind === "path" &&
      (argument.genericArguments?.length ?? 0) === 0 &&
      argument.path === expression.params[index]?.name)) return expression;
  return {
    kind: "path",
    path: call.path,
    ...(call.genericArguments === undefined ? {} : { genericArguments: call.genericArguments }),
  };
}
