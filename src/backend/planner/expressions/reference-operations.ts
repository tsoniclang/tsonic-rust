import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";

export function planRustReferenceOperationCall(call: Node,
  _fact: Extract<RustTargetOperationFact, { readonly kind: "reference-operation" }>, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined): RustExpr | undefined {
  const selected = context.input.program.records.referenceOperation.get(call)
    ?? failRustPlannerInvariant("An admitted reference operation requires its exact native operand and storage plan.", call);
  const fact = selected.operation;
  const operand = planExpression(fact.operandExpression, context);
  if (operand === undefined) return undefined;
  const recipe = selected.recipe;
  switch (recipe.kind) {
    case "shared-reference": return { kind: "reference", expr: operand };
    case "mutable-reference": return { kind: "reference", expr: operand, mutable: true };
    case "load": return recipe.form === "reference" ? operand : recipe.form === "owned-string"
      ? { kind: "owned-string-from-borrowed-str", expression: operand } : { kind: "dereference", pointer: operand };
    case "store": {
      const value = planExpression(recipe.valueExpression, context);
      if (value === undefined) return undefined;
      if (recipe.evaluation.kind === "direct" || recipe.evaluation.kind === "compound") {
        return { kind: "assignment", operator: recipe.evaluation.kind === "compound" ? recipe.evaluation.operator : "=",
          target: { kind: "dereference", pointer: operand }, value };
      }
      const names = context.syntheticNames ?? failRustPlannerInvariant("An ordered reference store requires its native temporary-name allocator.", call);
      const valueName = allocateRustSyntheticName(names, "reference_store_value");
      const assignmentValue: RustExpr = { kind: "path", path: valueName };
      if (recipe.evaluation.kind === "value-first") return rustValueBlock([{ name: valueName, value }], {
        kind: "assignment", operator: "=", target: { kind: "dereference", pointer: operand }, value: assignmentValue });
      const targetName = allocateRustSyntheticName(names, "reference_store_target");
      const target: RustExpr = recipe.evaluation.target === "mutable-reborrow"
        ? { kind: "reference", mutable: true, expr: { kind: "dereference", pointer: operand } } : operand;
      return rustValueBlock([{ name: targetName, value: target }, { name: valueName, value }], {
        kind: "assignment", operator: "=", target: { kind: "dereference", pointer: { kind: "path", path: targetName } },
        value: assignmentValue });
    }
  }
}
