import type { Node } from "@tsonic/tsts";
import { tsonicKeepAliveFactKey } from "@tsonic/source-core/facts";
import type { RustOperationPolicyContext } from "./contracts.js";

export function readRustSourceKeepAlive(
  call: Node,
  context: RustOperationPolicyContext,
): { readonly call: Node; readonly valueExpression: Node } | undefined {
  const fact = context.facts.get(call, tsonicKeepAliveFactKey);
  return fact === undefined ? undefined : Object.freeze({
    call: fact.call,
    valueExpression: fact.valueExpression,
  });
}
