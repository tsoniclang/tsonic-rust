import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustNativeArrayStorageKey } from "../../../target-model/operations/native-memory.js";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustNativeLayout } from "./native-memory.js";
import { planFinalizedTargetInput } from "./conversions.js";

export function nativeRustArrayType(node: Node, context: RustPlanContext): RustType | undefined {
  const storage = context.input.program.facts.getFact(node, rustNativeArrayStorageKey);
  const type = storage === undefined ? undefined : rustTypeFromCarrierInContext(storage.layout.pointeeCarrier, context);
  if (type === undefined) return undefined;
  context.usedAliases?.add("rt");
  return { kind: "named", path: "rt::raw_memory::NativeArray", genericArguments: [{ kind: "type", type }] };
}

export function planNativeRustArray(node: Node, values: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const storage = context.input.program.facts.getFact(node, rustNativeArrayStorageKey);
  const type = nativeRustArrayType(node, context);
  const layout = storage === undefined ? undefined : planRustNativeLayout(storage.layout, context);
  return storage === undefined || type === undefined || layout === undefined ? undefined : {
    kind: "associated-call", owner: type, method: "new",
    args: [values, layout, { kind: "int-literal", text: `${storage.stride}usize` }],
  };
}

export function planNativeRustArrayAccess(node: Node, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
  method: "load" | "location_at"): RustExpr | undefined {
  const storage = context.input.program.facts.getFact(node, rustNativeArrayStorageKey);
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  const element = context.input.program.source.ast.as.AsElementAccessExpression(node);
  if (storage?.kind !== "element" || operation?.kind !== "provider-operation" || operation.abi.target.form !== "index" ||
    operation.abi.targetArguments.length !== 1 || element?.Expression === undefined || element.ArgumentExpression === undefined) return undefined;
  const receiver = planExpression(element.Expression, context);
  const index = planFinalizedTargetInput(context, operation.abi.targetArguments[0]!, element.Expression, [element.ArgumentExpression], node);
  return receiver === undefined || index === undefined ? undefined : { kind: "method-call", receiver, method, args: [index] };
}
