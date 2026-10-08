import type { AstReader, Node } from "@tsonic/tsts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import type { RustPlanWriter } from "../../target-model/facts/selections.js";
import { rustComputedMemberFactKey } from "../facts/operations/keys.js";

export function recordRustComputedCallEvaluation(
  ast: AstReader, facts: RustPlanWriter, source: ResolvedSourceCallInfo | undefined,
  callee: Node, evaluateReceiver: boolean,
): Node | undefined {
  const access = source?.sourceCalleeAccess;
  if (access?.kind !== "element" || access.expression !== callee) return undefined;
  recordRustComputedMemberEvaluation(ast, facts, access.expression,
    access.receiver.expression, access.argument.expression, "read", evaluateReceiver);
  return access.argument.expression;
}

export function recordRustComputedMemberEvaluation(
  ast: AstReader, facts: RustPlanWriter, expression: Node, receiver: Node,
  key: Node, accessMode: "read" | "write" | "read-write" | "delete",
  evaluateReceiver = true,
): void {
  const kind = ast.kindName(key);
  facts.set(expression, rustComputedMemberFactKey, Object.freeze({ receiver, key, accessMode, evaluateReceiver,
    evaluateKey: kind !== "KindStringLiteral" && kind !== "KindNumericLiteral" &&
      kind !== "KindNoSubstitutionTemplateLiteral",
  }), [{ message: "rust exact checker-selected computed member and key evaluation" }]);
}
