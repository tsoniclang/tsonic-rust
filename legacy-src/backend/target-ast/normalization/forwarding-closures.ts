import type { RustExpr } from "../syntax/nodes.js";

export function collapseRustForwardingClosure(expression: RustExpr): RustExpr {
  if (expression.kind !== "closure" ||
    expression.body.kind !== "call" && expression.body.kind !== "associated-call" ||
    expression.params.some(parameter => parameter.byRefCopy || parameter.type !== undefined) ||
    expression.params.length !== expression.body.args.length) return expression;
  const call = expression.body;
  if (call.kind === "call" && expression.params.some(parameter => parameter.name === call.path) ||
    !call.args.every((argument, index) => argument.kind === "path" &&
      (argument.genericArguments?.length ?? 0) === 0 &&
      argument.path === expression.params[index]?.name)) return expression;
  if (call.kind === "associated-call") return (call.genericArguments?.length ?? 0) === 0
    ? { kind: "associated-value", owner: call.owner, name: call.method,
      ...(call.trait === undefined ? {} : { trait: call.trait }) }
    : expression;
  return {
    kind: "path",
    path: call.path,
    ...(call.genericArguments === undefined ? {} : { genericArguments: call.genericArguments }),
  };
}
