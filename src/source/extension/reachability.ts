import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { Node } from "@tsonic/tsts";
import { tsonicKeepAliveFactKey } from "@tsonic/source-core/facts";

export function readRustSourceKeepAlive(
  call: Node,
  context: { readonly source: Pick<TargetSourceProgram, "sourceFacts"> },
): { readonly call: Node; readonly valueExpression: Node } | undefined {
  const fact = context.source.sourceFacts.getFact(call, tsonicKeepAliveFactKey);
  return fact === undefined ? undefined : Object.freeze({
    call: fact.call,
    valueExpression: fact.valueExpression,
  });
}
