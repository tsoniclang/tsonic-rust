import type { AstReader, Node } from "@tsonic/tsts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import type { RustProgramRecordWriter } from "../program/records/model.js";


export function recordRustComputedCallEvaluation(
  ast: AstReader, records: RustProgramRecordWriter, source: ResolvedSourceCallInfo | undefined,
  callee: Node, evaluateReceiver: boolean,
): Node | undefined {
  const access = source?.sourceCalleeAccess;
  if (access?.kind !== "element" || access.expression !== callee) return undefined;
  recordRustComputedMemberEvaluation(ast, records, access.expression,
    access.receiver.expression, access.argument.expression, "read", evaluateReceiver);
  return access.argument.expression;
}

export function recordRustComputedMemberEvaluation(
  ast: AstReader, records: RustProgramRecordWriter, expression: Node, receiver: Node,
  key: Node, accessMode: "read" | "write" | "read-write" | "delete",
  evaluateReceiver = true,
): void {
  const kind = ast.kindName(key);
  records.computedMember.set(expression, Object.freeze({ receiver, key, accessMode, evaluateReceiver,
    evaluateKey: kind !== "KindStringLiteral" && kind !== "KindNumericLiteral" &&
      kind !== "KindNoSubstitutionTemplateLiteral",
  }), [{ message: "rust exact checker-selected computed member and key evaluation" }]);
}
