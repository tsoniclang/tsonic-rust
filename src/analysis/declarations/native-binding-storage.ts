import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustFrameCallableBinding, RustFrameCallableDefinition, RustFrameCallablePlan } from "../callables/frame-values.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeBindingStorage, RustNativeStorageBinding, RustNativeStorageBindingRequest }
  from "../../target-model/records/physical-emission-contexts.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustNativeBindingStorage } from "../../policy/ownership/binding-storage.js";
import { rustNativeFrameCallableCarriers, rustNativeFrameDefinitionCarrier, rustNativeTypeSelectionInput,
  selectRustNativeTypeCarrier, type RustNativeTypeInputContext } from "../../policy/types/model/native-type-selection.js";

export interface RustNativeBindingStoragePublicationInput {
  readonly ast: AstReader;
  readonly contextUse: TargetUseSiteRef;
  readonly requests: readonly RustNativeStorageBindingRequest[];
  readonly fieldBindings: readonly RustNativeStorageBinding[];
  readonly records: RustProgramRecords;
  readonly frames: RustFrameCallablePlan;
  readonly projectTypes: RustProjectTypePolicy;
  readonly nativeTypeContext: RustNativeTypeInputContext;
  readonly physicalCarrierFor: (carrier: TargetTypeRef, bindings: RustTargetGenericBindings) => TargetTypeRef | undefined;
}

export function publishRustNativeBindingStorage(
  input: RustNativeBindingStoragePublicationInput,
): TargetStageResult<readonly RustNativeStorageBinding[]> {
  const selected: RustNativeStorageBinding[] = [];
  const reject = (node: Node, message: string): TargetStageResult<readonly RustNativeStorageBinding[]> => rejectedTargetStage([{
    code: "RUST_NATIVE_STORAGE_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: node, message,
  }]);
  const nativeInput = rustNativeTypeSelectionInput(input.nativeTypeContext);
  for (const row of input.fieldBindings) {
    if (row.contextUse !== input.contextUse || row.owner.kind !== "field" || row.owner.declaration !== row.declaration ||
      selected.some(previous => previous.declaration === row.declaration))
      return reject(row.declaration, "A native field requires its original one completed slot in the exact physical context.");
    selected.push(row);
  }
  for (const request of input.requests) {
    const previous = selected.find(row => row.declaration === request.declaration);
    if (previous !== undefined) {
      if (previous.sourceBindings !== request.sourceBindings ||
        !rustTargetTypeRefEquals(previous.logicalCarrier, request.logicalCarrier))
        return reject(request.declaration, "One native storage occurrence requires its original correlated carrier and source bindings.");
      continue;
    }
    const frameBinding = input.frames.bindingFor(request.declaration);
    let storage: RustNativeBindingStorage;
    let owner: RustNativeStorageBinding["owner"];
    if (frameBinding !== undefined) {
      const definitions = input.frames.definitions.filter(definition => definition.bindings.includes(frameBinding));
      if (definitions.length !== 1) return reject(request.declaration,
        "A native frame slot requires the one original complete frame definition containing its binding.");
      const completed = completeRustNativeFrameBindingStorage({ binding: frameBinding, definition: definitions[0]!,
        sourceBindings: request.sourceBindings, projectTypes: input.projectTypes, nativeTypeContext: input.nativeTypeContext });
      if (completed.kind === "rejected") return completed;
      storage = completed.value;
      owner = Object.freeze({ kind: "frame", declaration: definitions[0]!.activation.ownerDeclaration,
        fieldName: frameBinding.fieldName });
    } else {
      const physical = input.physicalCarrierFor(request.logicalCarrier, request.sourceBindings);
      if (physical === undefined) return reject(request.declaration,
        "A native binding requires its actual selecting physical carrier before storage is applied.");
      const payload = selectRustNativeTypeCarrier(physical, nativeInput, "general");
      if (payload.kind === "rejected") return reject(request.declaration, payload.reason);
      const binding = input.records.bindingStorage.get(request.declaration);
      const module = input.records.moduleBinding.get(request.declaration);
      if (module?.storage === "module-cell") {
        const sourceFile = input.ast.getSourceFile(request.declaration);
        if (sourceFile === undefined) return reject(request.declaration, "A native module holder requires its actual checked module owner.");
        storage = selectRustNativeBindingStorage({ kind: "module", payloadCarrier: payload.carrier,
          initialization: module.initialization === "value" ? "ready" : "deferred" });
        owner = Object.freeze({ kind: "module", sourceFile });
      } else {
        if (binding !== undefined && !rustTargetTypeRefEquals(
          substituteRustTargetGenerics(binding.valueCarrier, request.sourceBindings.types,
            request.sourceBindings.lifetimes, request.sourceBindings.consts),
          substituteRustTargetGenerics(request.logicalCarrier, request.sourceBindings.types,
            request.sourceBindings.lifetimes, request.sourceBindings.consts)))
          return reject(request.declaration, "A native binding storage selection lost its original logical payload correspondence.");
        storage = selectRustNativeBindingStorage({ kind: "binding", payloadCarrier: payload.carrier,
          storage: binding?.storage ?? "value", initialization: binding?.initialization ?? "ready",
          nativeAllocation: input.records.nativeBacking.get(request.declaration) ?? null });
        owner = Object.freeze({ kind: "binding", declaration: request.declaration });
      }
    }
    selected.push(Object.freeze({ ...request, contextUse: input.contextUse, storage, owner }));
  }
  return resolvedTargetStage(Object.freeze(selected));
}

export function completeRustNativeFrameBindingStorage(input: {
  readonly binding: RustFrameCallableBinding;
  readonly definition: RustFrameCallableDefinition;
  readonly sourceBindings: RustTargetGenericBindings;
  readonly projectTypes: RustProjectTypePolicy;
  readonly nativeTypeContext: RustNativeTypeInputContext;
}): TargetStageResult<RustNativeBindingStorage> {
  const reject = (message: string): TargetStageResult<RustNativeBindingStorage> => rejectedTargetStage([{
    code: "RUST_NATIVE_FRAME_STORAGE_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: input.binding.declaration, message,
  }]);
  const { binding, definition, sourceBindings } = input;
  if (!definition.bindings.includes(binding)) return reject("A native frame slot must belong to its original selected frame definition.");
  const apply = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(carrier,
    sourceBindings.types, sourceBindings.lifetimes, sourceBindings.consts);
  const environment: TargetTypeRef[] = [];
  for (const parameter of definition.environmentParameters) {
    const selected = sourceBindings.types.get(parameter.identity);
    if (selected === undefined) return reject("A native frame holder requires every original environment argument, not one entry's partial environment.");
    environment.push(selected);
  }
  const ownerDefinition = definition.storage.kind !== "object" ? undefined
    : input.projectTypes.definitionForDeclaration(definition.activation.ownerDeclaration);
  if (definition.storage.kind === "object" && ownerDefinition?.kind !== "class")
    return reject("A native object frame requires its actual declaring class, not a guessed enclosing receiver.");
  const ownerInstance = ownerDefinition === undefined ? undefined : apply(input.projectTypes.openCarrier(ownerDefinition));
  const frame = rustNativeFrameDefinitionCarrier(definition, environment, ownerInstance, input.nativeTypeContext);
  if (frame === undefined) return reject("A native frame holder has no exact complete native owner application.");
  const carrier = apply(binding.carrier);
  const entry = binding.entry === undefined ? undefined : input.nativeTypeContext.callableValues.frames.entryFor(carrier);
  const frameCarriers = binding.entry === undefined ? undefined : rustNativeFrameCallableCarriers(carrier, input.nativeTypeContext);
  if (binding.entry !== undefined && (frameCarriers === undefined || entry !== binding.entry ||
    input.nativeTypeContext.callableValues.frames.definitionFor(carrier) !== definition))
    return reject("A native callable frame binding requires its exact selected entry and original environment application.");
  const payload = selectRustNativeTypeCarrier(frameCarriers?.entry ?? carrier,
    rustNativeTypeSelectionInput(input.nativeTypeContext), "general");
  if (payload.kind === "rejected") return reject(payload.reason);
  const nativeFrame = selectRustNativeTypeCarrier(frame, rustNativeTypeSelectionInput(input.nativeTypeContext), "general");
  if (nativeFrame.kind === "rejected") return reject(nativeFrame.reason);
  const ownerCarrier = definition.storage.kind !== "standalone" ? nativeFrame.carrier
    : Object.freeze(rustNamedTargetType("rust.alloc.rc.Rc", "alloc::rc::Rc",
        Object.freeze([Object.freeze({ kind: "type" as const, type: nativeFrame.carrier })]), [], undefined, [], undefined, []));
  return resolvedTargetStage(selectRustNativeBindingStorage({ kind: "frame", storage: binding.storage,
    initialization: binding.initialization, payloadCarrier: payload.carrier, ownerCarrier,
    ownerConstructor: definition.storage.kind === "standalone" ? "alloc::rc::Rc::new" : null }));
}
