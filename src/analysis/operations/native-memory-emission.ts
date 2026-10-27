import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustNativeLayoutProducer } from "../program/records/native/native-layout-emission.js";
import type { RustNativeMemoryLayout } from "../../target-model/operations/native-memory.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRuntimeNativeLayoutTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustFixedArrayCarrierValue, rustTargetConstInteger } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustNativeMemoryEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustNativeLayoutProducer): readonly TargetTypeRef[] {
  const pending: RustNativeMemoryLayout[] = [];
  const carriers: TargetTypeRef[] = [];
  for (const shape of program.structuralShapes.instances) for (const field of shape.fields)
    if (field.nativeLayout !== undefined) pending.push(field.nativeLayout);
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const backing = program.records.nativeBacking.get(node);
    const array = program.records.nativeArrayStorage.get(node);
    const handler = program.records.nativeHandler.get(node);
    if (backing !== undefined) pending.push(backing);
    if (array !== undefined) { pending.push(array.layout); carriers.push(array.runtimeCarrier); }
    if (handler?.kind === "native-pointer" && handler.selection.kind === "raw-location") pending.push(handler.selection.plan.layout);
  }
  const active = new Set<RustNativeMemoryLayout>();
  const visit = (layout: RustNativeMemoryLayout): boolean => {
    const previous = producer.records.nativeLayoutEmission.get(layout);
    if (previous !== undefined) return previous.hasWrites;
    if (active.has(layout)) failTargetAnalysisInvariant("tsonic-rust", "A closed native layout requires finite nonrecursive physical storage.");
    active.add(layout);
    const owner = rustRuntimeNativeLayoutTargetType(layout.pointeeCarrier);
    carriers.push(owner, layout.pointeeCarrier);
    const fields: string[] = [];
    let hasWrites = true;
    if (layout.kind === "array") {
      const fixed = rustFixedArrayCarrierValue(layout.pointeeCarrier);
      if (fixed === undefined || rustTargetConstInteger(fixed.length) !== BigInt(layout.length) ||
        typeof layout.stride !== "bigint" || layout.stride < 0n)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted array layout requires its exact native extent and stride.");
      const childWrites = visit(layout.element);
      hasWrites = layout.length !== "0" && (layout.element.size !== 0n || childWrites);
    } else if (layout.kind === "record") {
      hasWrites = false;
      for (const field of layout.fields) {
        const selected = field.projection.kind === "value-field"
          ? program.structuralShapes.field(layout.pointeeCarrier, field.projection.storageIndex) : undefined;
        if (field.projection.kind === "value-field" && (selected === undefined || selected.storage !== "stored" ||
          selected.nativeLayout !== undefined || selected.method === true || !rustTargetTypeRefEquals(selected.carrier, field.layout.pointeeCarrier)))
          failTargetAnalysisInvariant("tsonic-rust", "An admitted native layout field requires its exact stored value projection.");
        const name = field.projection.kind === "native-field" ? field.projection.name : selected!.targetName;
        if (fields.includes(name)) failTargetAnalysisInvariant("tsonic-rust", "A native layout requires unique physical field names.");
        fields.push(name);
        hasWrites = visit(field.layout) || hasWrites;
      }
    }
    producer.publish(layout, { owner, fields: Object.freeze(fields), hasWrites });
    active.delete(layout);
    return hasWrites;
  };
  for (const layout of pending) visit(layout);
  return Object.freeze(carriers);
}
