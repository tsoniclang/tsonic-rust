import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustNativeLayout } from "./native-memory.js";
import { planFinalizedTargetInput } from "./conversions.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function nativeRustArrayType(node: Node, context: RustPlanContext): RustType | undefined {
  const storage = context.input.program.records.nativeArrayStorage.get(node);
  return storage === undefined ? undefined
    : rustTypeFromCarrierInContext(storage.runtimeCarrier, context)
      ?? failRustPlannerInvariant("An admitted native array requires its runtime storage type.", node);
}

export function planNativeRustArray(node: Node, values: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const storage = context.input.program.records.nativeArrayStorage.get(node);
  const type = nativeRustArrayType(node, context);
  const layout = storage === undefined ? undefined : planRustNativeLayout(storage.layout, context);
  if (storage === undefined) return undefined;
  if (type === undefined || layout === undefined) failRustPlannerInvariant("An admitted native array requires its native type and layout.", node);
  return {
    kind: "associated-call", owner: type, method: "new",
    args: [values, layout, { kind: "int-literal", text: `${storage.stride}usize` }],
  };
}

export function planNativeRustArrayAccess(node: Node, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
  method: "load" | "location_at"): RustExpr | undefined {
  const storage = context.input.program.records.nativeArrayStorage.get(node);
  const operation = context.input.program.records.targetOperation.get(node);
  const element = context.input.program.source.ast.as.AsElementAccessExpression(node);
  if (storage?.kind !== "element") return undefined;
  if (operation?.kind !== "provider-operation" || element?.Expression === undefined || element.ArgumentExpression === undefined)
    failRustPlannerInvariant("An admitted native array element requires its exact provider operation and source operands.", node);
  const receiver = planExpression(element.Expression, context);
  const index = planFinalizedTargetInput(context, operation.abi.targetArguments[0]!, element.Expression, [element.ArgumentExpression], node);
  if (receiver === undefined || index === undefined) failRustPlannerInvariant("An admitted native array element requires its planned receiver and index.", node);
  return { kind: "method-call", receiver, method, args: [index] };
}
