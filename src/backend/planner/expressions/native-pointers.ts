import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustNativePointerOperation(node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }>, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined): RustExpr | undefined {
  const pointer = planExpression(fact.pointerExpression, context);
  if (pointer === undefined) return undefined;
  const dereference: RustExpr = { kind: "dereference", pointer };
  switch (fact.operation) {
    case "load": return dereference;
    case "store": {
      if (fact.valueExpression === undefined) failRustPlannerInvariant("An admitted pointer store requires its exact source value.", node);
      const value = planExpression(fact.valueExpression, context);
      return value === undefined ? undefined : { kind: "assignment", operator: "=", target: dereference, value };
    }
    case "offset": {
      if (fact.offsetExpression === undefined) failRustPlannerInvariant("An admitted pointer offset requires its exact source displacement.", node);
      const offset = planExpression(fact.offsetExpression, context);
      return offset === undefined ? undefined : { kind: "method-call", receiver: pointer, method: "offset", args: [offset] };
    }
  }
}
