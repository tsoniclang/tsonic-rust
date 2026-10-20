import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planRustReferenceOperationCall(call: Node,
  _fact: Extract<RustTargetOperationFact, { readonly kind: "reference-operation" }>, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined): RustExpr | undefined {
  const selected = context.input.program.records.referenceOperation.get(call)
    ?? failRustPlannerInvariant("An admitted reference operation requires its exact native operand and storage plan.", call);
  const fact = selected.operation;
  const operand = planExpression(fact.operandExpression, context);
  if (operand === undefined) return undefined;
  switch (fact.operation) {
    case "shared-reference": return { kind: "reference", expr: operand };
    case "mutable-reference": return { kind: "reference", expr: operand, mutable: true };
    case "load": return selected.load === "reference" ? operand : selected.load === "owned-string"
      ? { kind: "owned-string-from-borrowed-str", expression: operand } : { kind: "dereference", pointer: operand };
    case "store": {
      const value = planExpression(fact.writeStrategy?.rightExpression ?? fact.valueExpression, context);
      return value === undefined ? undefined : { kind: "assignment", operator: fact.writeStrategy?.operator ?? "=",
        target: { kind: "dereference", pointer: operand }, value };
    }
  }
}
