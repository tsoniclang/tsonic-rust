import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustNativeMemoryLayout } from "../../../target-model/operations/native-memory.js";
import type { RustRawLocationPlan } from "../../../target-model/records/native/native-memory.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustNativeMemoryPaths } from "../../../target-model/names/native-memory.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planRustNativeAllocation(node: Node, initial: RustExpr, context: RustPlanContext, errorCarrier?: TargetTypeRef): RustExpr | undefined {
  const layout = context.input.program.records.nativeBacking.get(node);
  return layout === undefined ? undefined : planRustNativeMemoryCall("allocate_native_location", initial, layout, context, errorCarrier);
}

export function planRustRawLocation(node: Node, plan: RustRawLocationPlan, context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined): RustExpr | undefined {
  const value = planExpression(plan.expression, context);
  if (value === undefined) failRustPlannerInvariant("An admitted raw location requires its source operand.", node);
  const argument: RustExpr = plan.optionalInput
    ? { kind: "method-call", receiver: value, method: "as_ref", args: [] }
    : { kind: "call", path: "Some", args: [{ kind: "reference", expr: value }] };
  return planRustNativeMemoryCall(plan.operation === "to-raw" ? "location_to_raw" : "reinterpret_raw_location",
    argument, plan.layout, context, rustProgramErrorTargetType());
}

export function planRustNativeMemoryCall(method: "allocate_native_location" | "location_to_raw" | "reinterpret_raw_location",
  value: RustExpr, layout: RustNativeMemoryLayout, context: RustPlanContext, errorCarrier?: TargetTypeRef): RustExpr {
  const pointee = rustTypeFromCarrierInContext(layout.pointeeCarrier, context)
    ?? failRustPlannerInvariant("An admitted native allocation requires its exact pointee type.", context.callableDeclaration ?? context.sourceFile);
  const codec = planRustNativeLayout(layout, context);
  const error = errorCarrier === undefined ? { kind: "named" as const, path: "core::convert::Infallible" }
    : rustTypeFromCarrierInContext(errorCarrier, context)
      ?? failRustPlannerInvariant("An admitted native allocation requires its exact error type.", context.callableDeclaration ?? context.sourceFile);
  context.usedAliases?.add("rt");
  return { kind: "call", path: rustNativeMemoryPaths[method],
    genericArguments: [{ kind: "type", type: pointee }, { kind: "type", type: method === "location_to_raw" ? { kind: "infer" } : error }],
    args: [value, codec] };
}

export function planRustNativeLayout(layout: RustNativeMemoryLayout, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.nativeLayoutEmission.get(layout);
  if (selected === undefined) failRustPlannerInvariant("An admitted native layout requires its exact emission plan.", context.callableDeclaration ?? context.sourceFile);
  const owner = rustTypeFromCarrierInContext(selected.owner, context)
    ?? failRustPlannerInvariant("An admitted native layout requires its exact codec owner type.", context.callableDeclaration ?? context.sourceFile);
  const dimensions: RustExpr[] = [{ kind: "int-literal", text: `${layout.size}usize` },
    { kind: "int-literal", text: `${layout.alignment}usize` }, { kind: "int-literal", text: `${layout.width}u32` },
    { kind: "bool-literal", value: layout.littleEndian }];
  if (layout.kind === "scalar") return { kind: "associated-call", owner, method: "scalar", args: dimensions };
  const integer = (value: string | number | bigint): RustExpr => ({ kind: "int-literal", text: `${value}usize` });
  type Offset = { readonly expression: RustExpr; readonly zero: boolean };
  const addOffset = (offset: Offset, value: RustExpr): Offset => ({ zero: false,
    expression: offset.zero ? value : { kind: "binary", left: offset.expression, operator: "+", right: value } });
  const walk = (current: RustNativeMemoryLayout, fieldValue: RustExpr, offset: Offset, alignment: bigint, depth: number):
    { readonly read: RustExpr; readonly writes: readonly RustStmt[] } => {
    const emission = context.input.program.records.nativeLayoutEmission.get(current);
    if (emission === undefined) failRustPlannerInvariant("An admitted native layout requires each closed child plan.", context.callableDeclaration ?? context.sourceFile);
    const type = rustTypeFromCarrierInContext(current.pointeeCarrier, context)
      ?? failRustPlannerInvariant("An admitted native layout child requires its pointee syntax.", context.callableDeclaration ?? context.sourceFile);
    if (current.kind === "array") {
      if (type.kind !== "fixed-array") failRustPlannerInvariant("An admitted native array layout requires fixed-array type syntax.", context.callableDeclaration ?? context.sourceFile);
      if (current.length === "0") return { read: { kind: "slice-literal", elements: [] }, writes: [] };
      const index = `index_${depth}`;
      const indexExpression: RustExpr = { kind: "path", path: index };
      const elementOffset = current.stride === 0n ? offset : addOffset(offset,
        { kind: "binary", left: indexExpression, operator: "*", right: integer(current.stride) });
      const element = walk(current.element, { kind: "index", receiver: fieldValue, index: indexExpression },
        elementOffset, alignment < current.element.alignment ? alignment : current.element.alignment, depth + 1);
      if (!emission.hasWrites) return { read: { kind: "array-repeat", element: element.read, length: type.length }, writes: [] };
      return { read: { kind: "call", path: "core::array::from_fn", args: [
        { kind: "closure", params: [{ name: index, byRefCopy: false }], body: element.read }] },
        writes: [{ kind: "for", binding: index, iterable: { kind: "range", start: integer(0), end: integer(current.length) },
          body: { statements: element.writes } }] };
    }
    if (current.kind === "record") {
      if (type.kind !== "named") failRustPlannerInvariant("An admitted native record layout requires named type syntax.", context.callableDeclaration ?? context.sourceFile);
      const fields: { readonly name: string; readonly value: RustExpr }[] = [];
      const writes: RustStmt[] = [];
      for (const [index, field] of current.fields.entries()) {
        const name = emission.fields[index];
        if (name === undefined) failRustPlannerInvariant("An admitted native field requires its selected physical name.", context.callableDeclaration ?? context.sourceFile);
        const value = walk(field.layout, { kind: "field", receiver: fieldValue, name },
          field.offset === 0n ? offset : addOffset(offset, integer(field.offset)), alignment < field.alignment ? alignment : field.alignment, depth + 1);
        fields.push({ name, value: value.read }); writes.push(...value.writes);
      }
      return { read: { kind: "struct-literal", path: type.path, fields }, writes };
    }
    const call = (method: string, value?: RustExpr): RustExpr => ({ kind: "unsafe", expression: {
      kind: "method-call", receiver: { kind: "path", path: "pointer" }, method,
      genericArguments: [{ kind: "type", type }], args: [offset.expression, { kind: "int-literal", text: `${alignment}usize` },
        ...(value === undefined ? [] : [value])] } });
    return { read: call("read_at"), writes: [{ kind: "expr", expr: call("write_at", fieldValue) }] };
  };
  const value = walk(layout, { kind: "path", path: "value" }, { expression: integer(0), zero: true }, layout.alignment, 0);
  return { kind: "associated-call", owner, method: "new", args: [...dimensions,
    { kind: "closure", params: [{ name: selected.hasWrites ? "pointer" : "_pointer", byRefCopy: false }], body: value.read },
    { kind: "closure-block", move: false, async: false,
      params: [{ name: selected.hasWrites ? "pointer" : "_pointer", mutable: false }, { name: selected.hasWrites ? "value" : "_value", mutable: false }],
      body: { statements: value.writes } }] };
}
