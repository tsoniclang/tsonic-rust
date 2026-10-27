import type { AstReader, Node } from "@tsonic/tsts";
import { sourceCallableValueExpression } from "@tsonic/target-api/source";
import type { RustOperationAttempt } from "../program/operation-attempts.js";
import type { RustCallbackOperationTemplate } from "../../target-model/operations/model.js";
import { rustRuntimeErrorTargetType } from "../../target-model/types/carriers/runtime-carriers.js";

export function rustCallableClosureErrorBoundary(node: Node, ast: AstReader,
  attempts: Pick<WeakMap<Node, RustOperationAttempt>, "get">):
  Extract<RustCallbackOperationTemplate["failure"], { readonly kind: "invocation" }>["resultError"] {
  const inner = sourceCallableValueExpression(ast, node, { typeAssertions: "transparent" });
  let expression = node;
  let parent = ast.parent(expression);
  while (parent !== undefined && inner !== undefined &&
    sourceCallableValueExpression(ast, parent, { typeAssertions: "transparent" }) === inner) {
    expression = parent;
    parent = ast.parent(expression);
  }
  const attempt = parent === undefined ? undefined : attempts.get(parent);
  const prepared = attempt?.kind === "checked-call" ? attempt.prepared?.value : undefined;
  if (attempt?.kind === "checked-call" && prepared?.callback.failure.kind === "invocation" &&
    attempt.request.source.sourceArguments[prepared.callback.sourceArgumentIndex]?.expression === expression)
    return prepared.callback.failure.resultError;
  return { kind: "native", carrier: rustRuntimeErrorTargetType() };
}
