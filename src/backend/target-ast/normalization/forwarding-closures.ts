import type { RustExpr } from "../syntax/nodes.js";

/**
 * A closure that only forwards its parameters, in order, to a function or associated function is that function
 * itself (`|left, right| compare(left, right)` is `compare`; clippy::redundant_closure). Syntax only: parameters are
 * unannotated, plain bindings and are not the callee.
 */
export function collapseRustForwardingClosure(expression: RustExpr): RustExpr {
  const block = expression.kind === "closure-block" && !expression.async && expression.body.statements.length === 1 &&
    (expression.body.innerAttrs?.length ?? 0) === 0 ? expression.body.statements[0] : undefined;
  const body = expression.kind === "closure" ? expression.body
    : block?.kind === "tail" && (block.attrs?.length ?? 0) === 0 ? block.expr : undefined;
  if ((expression.kind !== "closure" && expression.kind !== "closure-block") || body === undefined ||
    body.kind !== "call" && body.kind !== "associated-call" ||
    expression.params.some(parameter => parameter.byRefCopy === true || parameter.type !== undefined || parameter.mutable === true ||
      (parameter.attrs?.length ?? 0) !== 0) ||
    expression.params.length !== body.args.length) return expression;
  if (body.kind === "call" && expression.params.some(parameter => parameter.name === body.path) ||
    !body.args.every((argument, index) => argument.kind === "path" && (argument.genericArguments?.length ?? 0) === 0 &&
      argument.path === expression.params[index]?.name)) return expression;
  if (body.kind === "associated-call") return (body.genericArguments?.length ?? 0) === 0
    ? { kind: "associated-value", owner: body.owner, name: body.method, ...(body.trait === undefined ? {} : { trait: body.trait }) }
    : expression;
  return { kind: "path", path: body.path, ...(body.genericArguments === undefined ? {} : { genericArguments: body.genericArguments }) };
}
