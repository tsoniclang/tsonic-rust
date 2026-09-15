import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";

export function isRustDeclarationPathUse(
  node: Node,
  ast: AstReader,
  facts: RustPlanQueries,
): boolean {
  let current = node;
  let throughMember = false;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === undefined || Node_Expression(ast, parent) !== current) return false;
    const kind = ast.kindName(parent);
    if (kind === "KindParenthesizedExpression") {
      current = parent;
      continue;
    }
    const operation = facts.getFact(parent, rustTargetOperationFactKey);
    if (kind === "KindPropertyAccessExpression" || kind === "KindElementAccessExpression") {
      if (operation?.kind === "source-static-field" ||
        operation?.kind === "source-accessor" && operation.receiver.kind === "static") return true;
      current = parent;
      throughMember = true;
      continue;
    }
    if (operation?.kind !== "source-call" || operation.target.form === "callable" ||
      operation.target.form === "structural-method" || operation.target.form === "union-method") return false;
    const selected = facts.getSelectedTargetCall(parent);
    return selected?.sourceDeclaration !== undefined &&
      (!throughMember || operation.target.form === "function" ||
        selected.member.static === true || selected.member.kind === "constructor");
  }
}
