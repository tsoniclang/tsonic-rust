import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustNativeBackingKey, rustRawLocationPlanKey } from "../../../target-model/operations/native-memory.js";
import type { RustNativeMemoryLayout } from "../../../target-model/operations/native-memory.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustOptionElementCarrier, rustStructuralObjectCarrierValue } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

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
  if (value.kind === "bottom") return { handled: true, expression: value };
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
    genericArguments: [{ kind: "type", type: pointee },
      ...(method === "location_to_raw" ? [{ kind: "type" as const, type: { kind: "infer" as const } }] : [])],
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
  const integer = (value: string | number): RustExpr => ({ kind: "int-literal", text: `${value}usize` });
  const addOffset = (offset: RustExpr, value: RustExpr): RustExpr =>
    offset.kind === "int-literal" && offset.text === "0usize" ? value :
      { kind: "binary", left: offset, operator: "+", right: value };
  const walk = (
    current: RustNativeMemoryLayout, fieldValue: RustExpr, offset: RustExpr, alignment: number, depth: number,
  ): { readonly read: RustExpr; readonly writes: readonly RustStmt[] } | undefined => {
    const type = rustTypeFromCarrierInContext(current.pointeeCarrier, context);
    if (type === undefined) return undefined;
    if (current.kind === "array") {
      if (!/^(0|[1-9][0-9]*)$/u.test(current.length) ||
        !Number.isSafeInteger(current.stride) || current.stride < 0 ||
        type.kind !== "fixed-array" || type.length.kind !== "integer" ||
        type.length.value !== BigInt(current.length)) return undefined;
      if (current.length === "0") return { read: { kind: "slice-literal", elements: [] }, writes: [] };
      const index = `index_${depth}`;
      const indexExpression: RustExpr = { kind: "path", path: index };
      const elementOffset = current.stride === 0 ? offset : addOffset(offset,
        { kind: "binary", left: indexExpression, operator: "*", right: integer(current.stride) });
      const element = walk(current.element, { kind: "index", receiver: fieldValue, index: indexExpression },
        elementOffset, Math.min(alignment, current.element.alignment), depth + 1);
      if (element === undefined) return undefined;
      if (current.element.size === 0 && element.writes.length === 0) {
        return { read: { kind: "array-repeat", element: element.read, length: type.length }, writes: [] };
      }
      return {
        read: { kind: "call", path: "core::array::from_fn", args: [
          { kind: "closure", params: [{ name: index, byRefCopy: false }], body: element.read },
        ] },
        writes: [{ kind: "for", binding: index,
          iterable: { kind: "range", start: integer(0), end: integer(current.length) },
          body: { statements: element.writes } }],
      };
    }
    if (current.kind === "record") {
      if (type.kind !== "named") return undefined;
      const structural = rustStructuralObjectCarrierValue(current.pointeeCarrier);
      if (structural !== undefined && (structural.representation !== "value" || structural.fields.length !== current.fields.length)) return undefined;
      const fields: { name: string; value: RustExpr }[] = [];
      const writes: RustStmt[] = [];
      for (const field of current.fields) {
        if ((structural !== undefined) !== (field.projection.kind === "value-field")) return undefined;
        const stored = field.projection.kind === "value-field"
          ? context.input.program.structuralShapes.field(current.pointeeCarrier, field.projection.storageIndex) : undefined;
        if (field.projection.kind === "value-field" && (stored === undefined || stored.storage !== "stored" ||
          stored.nativeLayout !== undefined || stored.method === true ||
          !rustTargetTypeRefEquals(stored.carrier, field.layout.pointeeCarrier))) return undefined;
        const name = field.projection.kind === "native-field" ? field.projection.name : stored!.targetName;
        if (fields.some(candidate => candidate.name === name)) return undefined;
        const value = walk(field.layout, { kind: "field", receiver: fieldValue, name },
          field.offset === 0 ? offset : addOffset(offset, integer(field.offset)),
          Math.min(alignment, field.alignment), depth + 1);
        if (value === undefined) return undefined;
        fields.push({ name, value: value.read });
        writes.push(...value.writes);
      }
      return { read: { kind: "struct-literal", path: type.path, fields }, writes };
    }
    const call = (method: string, value?: RustExpr): RustExpr => ({ kind: "unsafe", expression: {
      kind: "method-call", receiver: { kind: "path", path: "pointer" }, method,
      genericArguments: [{ kind: "type", type }], args: [offset,
        { kind: "int-literal", text: `${alignment}usize` }, ...(value === undefined ? [] : [value])],
    } });
    return { read: call("read_at"), writes: [{ kind: "expr", expr: call("write_at", fieldValue) }] };
  };
  const value = walk(layout, { kind: "path", path: "value" }, integer(0), layout.alignment, 0);
  if (value === undefined) return undefined;
  const writes = value.writes;
  return { kind: "associated-call", owner, method: "new", args: [...dimensions,
    { kind: "closure", params: [{ name: writes.length === 0 ? "_pointer" : "pointer", byRefCopy: false }], body: value.read },
    { kind: "closure-block", move: false, async: false,
      params: [{ name: writes.length === 0 ? "_pointer" : "pointer", mutable: false },
        { name: writes.length === 0 ? "_value" : "value", mutable: false }], body: { statements: writes } },
  ] };
}
