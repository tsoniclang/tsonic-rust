import type { AstReader, Node } from "@tsonic/tsts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import type { RustProgramRecordWriter } from "../program/records/model.js";

export function recordRustComputedCallEvaluation(
  ast: AstReader, records: RustProgramRecordWriter, source: ResolvedSourceCallInfo | undefined,
  callee: Node, evaluateReceiver: boolean,
): Node | undefined {
  records.assertOpen();
  const access = source?.sourceCalleeAccess;
  if (access?.kind !== "element" || access.expression !== callee) return undefined;
  const evaluation = records.computedMembers.evaluate(ast, access.expression,
    access.receiver.expression, access.argument.expression, "read", evaluateReceiver);
  return evaluation.key;
}
