import type { Node, SourceFile } from "@tsonic/tsts";
import { selectTsonicMemoryFieldBinding, selectTsonicMemoryRecordBinding } from "@tsonic/source-core/facts";
import { rustSourceLocationTargetType, rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustMemoryBindingPlanKey } from "../../target-model/operations/memory-bindings.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { setCarrierFact } from "./project-calls.js";

export function resolveRustMemoryBindingCarrier(walk: RustFactWalk, expression: Node, file: SourceFile) {
  const { ast, source } = walk.context;
  const field = selectTsonicMemoryFieldBinding(ast, source.sourceFacts, expression);
  const record = selectTsonicMemoryRecordBinding(ast, source.sourceFacts, expression);
  if (field === undefined && record === undefined) return undefined;
  const reject = (message: string, evidence: readonly string[] = []) => {
    appendRustDiagnostic(walk, "RUST_MEMORY_BINDING_NOT_PROVEN", message, expression, evidence);
    return { handled: true as const };
  };
  const resolution = rustResolutionContext(walk, expression);
  if (field?.kind === "rejected") return reject(field.reason);
  if (record?.kind === "rejected") return reject(record.reason);
  if (field?.kind === "resolved") {
    const operation = field.operation;
    const pointee = resolveRustTargetTypeRef(operation.field.fieldLayout.explicitTypeNode ?? operation.pointeeType,
      resolution, walk.operationOptions);
    if (pointee === undefined) return reject("The bound field has no exact native value carrier.");
    const carrier = rustSourceLocationTargetType(pointee);
    const pointer = resolveExpressionCarrier(walk, operation.pointerExpression, file, carrier);
    if (!rustTargetTypeRefEquals(pointer, carrier)) return reject("The bound field and selected location have different native value carriers.");
    walk.context.facts.set(expression, rustMemoryBindingPlanKey, Object.freeze({ kind: "field", carrier, expression: operation.pointerExpression }));
    return { handled: true as const, carrier: setCarrierFact(walk, expression, carrier) };
  }
  if (record?.kind !== "resolved") return reject("The selected record binding has no finalized operation.");
  const operation = record.operation;
  const carrier = resolveRustTargetTypeRef(operation.layout.explicitTypeNode ?? operation.sourceType, resolution, walk.operationOptions);
  const structural = rustStructuralObjectCarrierValue(carrier);
  if (carrier === undefined || structural === undefined || structural.fields.length !== operation.fields.length) {
    return reject("The bound record requires one exact complete structural carrier.");
  }
  const fields: { expression: Node; storageIndex: number; carrier: TargetTypeRef }[] = [];
  const used = new Set<number>();
  for (const entry of operation.fields) {
    const selection = walk.sourceTypes.structuralFieldProjectionForDeclaration(entry.binding.field.selectedDeclaration, carrier) ??
      (entry.binding.field.selectedSymbol === undefined ? undefined :
        walk.sourceTypes.structuralFieldProjectionForSymbol(entry.binding.field.selectedSymbol, carrier));
    if (selection === undefined || used.has(selection.field.storageIndex)) return reject("The bound field has no unique selected storage member.");
    const member = structural.fields[selection.field.storageIndex];
    if (member?.bound !== true || member.accessor !== undefined || member.method === true || member.presence !== "required") {
      return reject("The record field has no finalized live-location storage.");
    }
    const pointer = rustSourceLocationTargetType(member.type);
    if (!rustTargetTypeRefEquals(resolveExpressionCarrier(walk, entry.expression, file, pointer), pointer)) {
      return reject("The bound member location has a conflicting native pointee carrier.");
    }
    used.add(selection.field.storageIndex);
    fields.push(Object.freeze({ expression: entry.expression, storageIndex: selection.field.storageIndex, carrier: pointer }));
  }
  walk.context.facts.set(expression, rustMemoryBindingPlanKey, Object.freeze({ kind: "record", carrier, fields: Object.freeze(fields) }));
  return { handled: true as const, carrier: setCarrierFact(walk, expression, carrier) };
}
