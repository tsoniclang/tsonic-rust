import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustNativeBackingKey, rustRawLocationPlanKey } from "../../../target-model/operations/native-memory.js";
import type { RustNativeMemoryLayout } from "../../../target-model/operations/native-memory.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";

export function planRustNativeAllocation(node: Node, initial: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const layout = context.input.program.facts.getFact(node, rustNativeBackingKey);
  return layout === undefined ? undefined : planRustNativeMemoryCall("allocate_native_location", initial, layout, context);
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
  return { handled: true, expression: planRustNativeMemoryCall(plan.operation === "to-raw"
    ? "location_to_raw" : "reinterpret_raw_location", argument, plan.layout, context) };
}

export function planRustNativeMemoryCall(method: "allocate_native_location" | "location_to_raw" | "reinterpret_raw_location", value: RustExpr, layout: RustNativeMemoryLayout, context: RustPlanContext): RustExpr | undefined {
  const pointee = rustTypeFromCarrierInContext(layout.pointeeCarrier, context);
  const codec = planRustNativeLayout(layout, context);
  if (pointee === undefined || codec === undefined) return undefined;
  context.usedAliases?.add("rt");
  return { kind: "call", path: `rt::raw_memory::${method}`,
    genericArguments: [{ kind: "type", type: pointee }],
    args: [value, codec] };
}

export function planRustNativeLayout(layout: RustNativeMemoryLayout, context: RustPlanContext): RustExpr | undefined {
  const pointee = rustTypeFromCarrierInContext(layout.pointeeCarrier, context);
  if (pointee === undefined) return undefined;
  const dimensions: RustExpr[] = [{ kind: "int-literal", text: `${layout.size}usize` },
      { kind: "int-literal", text: `${layout.alignment}usize` },
      { kind: "int-literal", text: `${layout.width}u32` },
      { kind: "bool-literal", value: layout.littleEndian }];
  const owner = { kind: "named" as const, path: "rt::raw_memory::NativeLayout",
    genericArguments: [{ kind: "type" as const, type: pointee }] };
  if (layout.kind === "scalar") return { kind: "associated-call", owner, method: "scalar", args: dimensions };
  const writes: RustStmt[] = [];
  const walk = (current: RustNativeMemoryLayout, names: readonly string[], offset: number, alignment: number): RustExpr | undefined => {
    const type = rustTypeFromCarrierInContext(current.pointeeCarrier, context);
    if (type === undefined) return undefined;
    if (current.kind === "record") {
      if (type.kind !== "named") return undefined;
      const fields: { name: string; value: RustExpr }[] = [];
      for (const field of current.fields) {
        const value = walk(field.layout, [...names, field.name], offset + field.offset, Math.min(alignment, field.alignment));
        if (value === undefined) return undefined;
        fields.push({ name: field.name, value });
      }
      return { kind: "struct-literal", path: type.path, fields };
    }
    const fieldValue = names.reduce<RustExpr>((receiver, name) => ({ kind: "field", receiver, name }), { kind: "path", path: "value" });
    const call = (method: string, value?: RustExpr): RustExpr => ({ kind: "unsafe", expression: {
      kind: "method-call", receiver: { kind: "path", path: "pointer" }, method,
      genericArguments: [{ kind: "type", type }], args: [{ kind: "int-literal", text: `${offset}usize` },
        { kind: "int-literal", text: `${alignment}usize` }, ...(value === undefined ? [] : [value])],
    } });
    writes.push({ kind: "expr", expr: call("write_at", fieldValue) });
    return call("read_at");
  };
  const value = walk(layout, [], 0, layout.alignment);
  if (value === undefined) return undefined;
  return { kind: "associated-call", owner, method: "new", args: [...dimensions,
    { kind: "closure", params: [{ name: writes.length === 0 ? "_pointer" : "pointer", byRefCopy: false }], body: value },
    { kind: "closure-block", move: false, async: false,
      params: [{ name: writes.length === 0 ? "_pointer" : "pointer", mutable: false },
        { name: writes.length === 0 ? "_value" : "value", mutable: false }], body: { statements: writes } },
  ] };
}
