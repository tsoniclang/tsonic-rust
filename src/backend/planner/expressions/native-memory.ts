import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustNativeBackingKey, rustRawLocationPlanKey } from "../../../target-model/operations/native-memory.js";
import type { RustNativeMemoryLayout } from "../../../target-model/operations/native-memory.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";

export function planRustNativeAllocation(node: Node, initial: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const layout = context.input.program.facts.getFact(node, rustNativeBackingKey);
  return layout === undefined ? undefined : planNativeCall("allocate_native_location", initial, layout, context);
}

export function tryPlanRustRawLocation(
  node: Node, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): { readonly handled: boolean; readonly expression?: RustExpr } {
  const plan = context.input.program.facts.getFact(node, rustRawLocationPlanKey);
  if (plan === undefined) return { handled: false };
  if (plan.operation === "reinterpret" && (context.explicitUnsafeContextDepth ?? 0) === 0) {
    context.diagnostics.push({ code: "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED", category: "error",
      source: "tsonic-rust", sourceNode: node,
      message: "Raw memory reinterpretation requires an explicit unsafeContext() source region." });
    return { handled: true };
  }
  const value = planExpression(plan.expression, context);
  if (value === undefined) return { handled: true };
  const borrowed = planRustNonConsumingValue(plan.expression, value, context);
  const argument: RustExpr = rustOptionElementCarrier(plan.inputCarrier) === undefined
    ? { kind: "call", path: "Some", args: [{ kind: "reference", expr: borrowed }] }
    : { kind: "method-call", receiver: borrowed, method: "as_ref", args: [] };
  return { handled: true, expression: planNativeCall(plan.operation === "to-raw"
    ? "location_to_raw" : "reinterpret_raw_location", argument, plan.layout, context) };
}

function planNativeCall(method: "allocate_native_location" | "location_to_raw" | "reinterpret_raw_location", value: RustExpr, layout: RustNativeMemoryLayout, context: RustPlanContext): RustExpr | undefined {
  const pointee = rustTypeFromCarrierInContext(layout.pointeeCarrier, context);
  if (pointee === undefined) return undefined;
  context.usedAliases?.add("rt");
  return { kind: "call", path: `rt::raw_memory::${method}`,
    genericArguments: [{ kind: "type", type: pointee }],
    args: [value, { kind: "int-literal", text: `${layout.size}usize` },
      { kind: "int-literal", text: `${layout.alignment}usize` },
      { kind: "int-literal", text: `${layout.width}u32` },
      { kind: "bool-literal", value: layout.littleEndian }] };
}
