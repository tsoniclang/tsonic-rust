import type { Node } from "@tsonic/tsts";
import type { RustNativeHandler } from "../../../target-model/records/native/native-handlers.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpressionResultUse } from "./entry.js";
import { planRustMemoryBinding } from "./memory-bindings.js";
import { planRustExplicitSafetyExpression } from "../safety/explicit-safety.js";
import { planRustRawLocation } from "./native-memory.js";
import { planRustRawAddress } from "./raw-addresses.js";
import { planRustNativePointerOperation } from "./native-pointers.js";
import { planCallExpression } from "./calls/basic.js";

export function planRustNativeHandler(
  node: Node,
  handler: RustNativeHandler,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  switch (handler.kind) {
    case "memory-binding": return planRustMemoryBinding(node, handler.selection, context, planExpression);
    case "explicit-safety": return planRustExplicitSafetyExpression(node, handler.selection, context, planExpression);
    case "js-string-conversion":
    case "typed-location": return planCallExpression(node, context, resultUse, handler);
    case "native-pointer": {
      const selected = handler.selection;
      switch (selected.kind) {
        case "raw-location": return planRustRawLocation(node, selected.plan, context, planExpression);
        case "layout-query": return { kind: "int-literal", text: `${selected.observation.value}usize` };
        case "raw-address":
        case "raw-identity": return planRustRawAddress(node, selected.plan, context, planExpression);
        case "native-pointer": return planRustNativePointerOperation(node, selected.operation, context, planExpression);
      }
    }
  }
}
