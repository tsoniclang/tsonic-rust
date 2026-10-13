import type { RustOperationPolicyContext } from "../../model/operation-context.js";

import type { Node } from "@tsonic/tsts";
import { tsonicKeepAliveFactKey } from "@tsonic/source-core/facts";


export function readRustSourceKeepAlive(
  call: Node,
  context: RustOperationPolicyContext,
): { readonly call: Node; readonly valueExpression: Node } | undefined {
  const fact = context.source.sourceFacts.getFact(call, tsonicKeepAliveFactKey);
  return fact === undefined ? undefined : Object.freeze({
    call: fact.call,
    valueExpression: fact.valueExpression,
  });
}
