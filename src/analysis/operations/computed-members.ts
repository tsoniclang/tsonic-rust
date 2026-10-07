import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanWriter } from "../../target-model/facts/selections.js";
import { rustComputedMemberFactKey } from "../facts/operations/keys.js";

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
