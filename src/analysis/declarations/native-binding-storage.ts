import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustFrameCallableBinding, RustFrameCallableDefinition, RustFrameCallablePlan } from "../callables/frame-values.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeBindingStorage, RustNativeStorageBinding, RustNativeStorageBindingRequest,
  RustNativeFrameBindingStorageCompletion }
  from "../../target-model/records/physical-emission-contexts.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectRustNativeBindingStorage, selectRustNativeFrameStorageOwner } from "../../policy/ownership/binding-storage.js";
import { rustNativeFrameCallableCarriers, rustNativeFrameDefinitionCarrier, rustNativeTypeSelectionInput,
  selectRustNativeTypeCarrier, type RustNativeTypeInputContext } from "../../policy/types/model/native-type-selection.js";
import type { RustPreparedNativeDeclarationForms, RustNativeCallableFieldBinding } from "./native-forms.js";
import type { RustNativeDeclarationForms } from "../../target-model/records/native-declaration-forms.js";
import type { RustCallableEmissionPreparation } from "../callables/emission-contexts.js";

export interface RustNativeBindingStoragePublicationInput {
  readonly ast: AstReader;
  readonly contextUse: TargetUseSiteRef;
  readonly requests: readonly RustNativeStorageBindingRequest[];
  readonly fieldBindings: readonly RustNativeStorageBinding[];
  readonly records: RustProgramRecords;
  readonly frames: RustFrameCallablePlan;
  readonly projectTypes: RustProjectTypePolicy;
  readonly nativeTypeContext: RustNativeTypeInputContext;
  readonly physicalCarrierFor: (request: RustNativeStorageBindingRequest) => TargetTypeRef | undefined;
}

export function completeRustNativeDeclarationStorage(input: {
  readonly declarations: RustPreparedNativeDeclarationForms;
  readonly declarationInput: Omit<Parameters<RustPreparedNativeDeclarationForms["complete"]>[0], "nativeFrameBindingFor">;
  readonly emission: RustCallableEmissionPreparation;
  readonly frames: RustFrameCallablePlan;
  readonly nativeTypeContextFor: (fileName: string) => RustNativeTypeInputContext;
}): TargetStageResult<{
  readonly forms: RustNativeDeclarationForms;
  readonly fieldBindings: readonly RustNativeCallableFieldBinding[];
  readonly nativeBindings: readonly RustNativeStorageBinding[];
}> {
  const reject = (declaration: Node, message: string): TargetStageResult<RustNativeFrameBindingStorageCompletion> => rejectedTargetStage([{
    code: "RUST_NATIVE_STORAGE_NOT_CLOSED", category: "error" as const, source: "tsonic-rust", sourceNode: declaration, message,
  }]);
  const declarations = input.declarations.complete({ ...input.declarationInput, nativeFrameBindingFor(request) {
    const binding = input.frames.bindingFor(request.declaration);
    const definitions = binding === undefined ? [] : input.frames.definitions.filter(definition => definition.bindings.includes(binding));
    if (binding === undefined || definitions.length !== 1) return reject(request.declaration,
      "A native frame field requires its exact binding and original complete frame definition.");
    const definition = definitions[0]!;
    const context = input.emission.contexts.contextForOwner(definition, "frame");
    const requests = context?.nativeBindingRequests.filter(selected => selected.declaration === request.declaration);
    if (context === undefined || requests?.length !== 1) return reject(request.declaration,
      "A native frame field requires its original one frame-context storage preparation.");
    const selected = requests[0]!;
    const carrier = input.emission.contexts.carrierFor(selected.use, selected.physicalCarrier);
    if (carrier === undefined) return reject(request.declaration,
      "A native frame field lost its actual selected physical payload before final declaration publication.");
    return completeRustNativeFrameBindingStorage({ binding, definition, sourceBindings: request.sourceBindings,
      physicalCarrier: substituteRustTargetGenerics(carrier, request.sourceBindings.types,
        request.sourceBindings.lifetimes, request.sourceBindings.consts),
      projectTypes: input.declarationInput.projectTypes,
      nativeTypeContext: input.nativeTypeContextFor(request.nativeOwnerFileName) });
  } });
  if (declarations.kind === "rejected") return declarations;
  const nativeBindings: RustNativeStorageBinding[] = [];
  for (const context of input.emission.contexts.contexts) {
    const selected = publishRustNativeBindingStorage({ ast: input.declarationInput.ast,
      contextUse: context.use, requests: context.nativeBindingRequests,
      fieldBindings: declarations.fieldBindings.filter(row => row.contextUse === context.use),
      records: input.declarationInput.records, frames: input.frames,
      projectTypes: input.declarationInput.projectTypes,
      nativeTypeContext: input.nativeTypeContextFor(context.nativeOwnerFileName),
      physicalCarrierFor: request => input.emission.contexts.carrierFor(request.use, request.physicalCarrier) });
    if (selected.kind === "rejected") return selected;
    nativeBindings.push(...selected.value);
  }
  return resolvedTargetStage(Object.freeze({ forms: declarations.forms, fieldBindings: declarations.fieldBindings,
    nativeBindings: Object.freeze(nativeBindings) }));
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
    selected.push(Object.freeze({ use: row.use, declaration: row.declaration, logicalCarrier: row.logicalCarrier,
      physicalCarrier: row.physicalCarrier, sourceBindings: row.sourceBindings, source: row.source,
      contextUse: row.contextUse, storage: row.storage, readCarrier: row.readCarrier, owner: row.owner }));
  }
  for (const request of input.requests) {
    const previous = selected.find(row => row.declaration === request.declaration);
    if (previous !== undefined) {
      if (previous.use !== request.use || previous.sourceBindings !== request.sourceBindings ||
        !rustTargetTypeRefEquals(previous.logicalCarrier, request.logicalCarrier) ||
        !rustTargetTypeRefEquals(previous.physicalCarrier, request.physicalCarrier))
        return reject(request.declaration, "One native storage occurrence requires its original correlated carrier and source bindings.");
      continue;
    }
    const frameBinding = request.source.kind === "capture" ? undefined : input.frames.bindingFor(request.declaration);
    const physical = input.physicalCarrierFor(request);
    if (physical === undefined) return reject(request.declaration,
      "A native binding requires its actual selecting use and physical carrier before storage is applied.");
    let storage: RustNativeBindingStorage;
    let readCarrier: TargetTypeRef;
    let owner: RustNativeStorageBinding["owner"];
    if (frameBinding !== undefined) {
      const definitions = input.frames.definitions.filter(definition => definition.bindings.includes(frameBinding));
      if (definitions.length !== 1) return reject(request.declaration,
        "A native frame slot requires the one original complete frame definition containing its binding.");
      const completed = completeRustNativeFrameBindingStorage({ binding: frameBinding, definition: definitions[0]!,
        physicalCarrier: physical, sourceBindings: request.sourceBindings,
        projectTypes: input.projectTypes, nativeTypeContext: input.nativeTypeContext });
      if (completed.kind === "rejected") return completed;
      storage = completed.value.storage;
      readCarrier = completed.value.readCarrier;
      owner = completed.value.owner;
    } else {
      const payload = selectRustNativeTypeCarrier(physical, nativeInput, "general");
      if (payload.kind === "rejected") return reject(request.declaration, payload.reason);
      readCarrier = payload.carrier;
      const binding = input.records.bindingStorage.get(request.declaration);
      const module = input.records.moduleBinding.get(request.declaration);
      if (request.source.kind === "capture") {
        storage = selectRustNativeBindingStorage({ kind: "binding", payloadCarrier: payload.carrier,
          storage: request.source.storage, initialization: request.source.initialization,
          nativeAllocation: input.records.nativeBacking.get(request.declaration) ?? null });
        owner = Object.freeze({ kind: "binding", declaration: request.declaration });
      } else if (request.source.kind === "field") {
        const source = request.source;
        if (source.storage.kind === "frame") return reject(request.declaration,
          "A native frame field requires its actual binding in the original complete frame definition.");
        const capture = source.storage.kind === "capture" ? source.storage.selection : undefined;
        storage = capture === undefined ? selectRustNativeBindingStorage({ kind: "binding", storage: "value",
          initialization: "ready", payloadCarrier: payload.carrier, nativeAllocation: null })
          : capture.kind === "copy" ? selectRustNativeBindingStorage({ kind: "captured-field", storage: "copy",
              initialization: "ready", payloadCarrier: payload.carrier })
            : selectRustNativeBindingStorage({ kind: "captured-field", storage: capture.kind,
                initialization: capture.initialization, payloadCarrier: payload.carrier });
        owner = Object.freeze({ kind: "field", declaration: request.declaration, definingOwner: source.definingOwner,
          storageIndex: source.storageIndex, targetName: source.targetName });
      } else if (request.source.kind === "module" || module?.storage === "module-cell" ||
        module?.storage === "native-callable" && module.value !== undefined) {
        const sourceFile = input.ast.getSourceFile(request.declaration);
        if (sourceFile === undefined) return reject(request.declaration, "A native module holder requires its actual checked module owner.");
        if (request.source.kind === "module" && request.source.sourceFile !== sourceFile)
          return reject(request.declaration, "A native module holder lost its original checked module identity.");
        const initialization = request.source.kind === "module" ? request.source.initialization
          : module?.storage === "module-cell" && module.initialization === "declaration" ? "deferred" : "ready";
        storage = selectRustNativeBindingStorage({ kind: "module", payloadCarrier: payload.carrier,
          initialization });
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
    if (owner.kind === "frame") {
      const declaration = owner.declaration;
      const existing = selected.find(row => row.owner.kind === "frame" && row.owner.declaration === declaration);
      if (existing?.owner.kind === "frame" && (!rustTargetTypeRefEquals(existing.owner.frameCarrier, owner.frameCarrier) ||
        !rustTargetTypeRefEquals(existing.owner.holderCarrier, owner.holderCarrier) ||
        existing.owner.constructor !== owner.constructor)) return reject(request.declaration,
        "Every field of one native frame must retain the identical completed whole owner and constructor.");
    }
    selected.push(Object.freeze({ ...request, contextUse: input.contextUse, storage, readCarrier, owner }));
  }
  return resolvedTargetStage(Object.freeze(selected));
}

export function completeRustNativeFrameBindingStorage(input: {
  readonly binding: RustFrameCallableBinding;
  readonly definition: RustFrameCallableDefinition;
  readonly physicalCarrier: TargetTypeRef;
  readonly sourceBindings: RustTargetGenericBindings;
  readonly projectTypes: RustProjectTypePolicy;
  readonly nativeTypeContext: RustNativeTypeInputContext;
}): TargetStageResult<RustNativeFrameBindingStorageCompletion> {
  const reject = (message: string): TargetStageResult<RustNativeFrameBindingStorageCompletion> => rejectedTargetStage([{
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
  const carrier = apply(input.physicalCarrier);
  const entry = binding.entry === undefined ? undefined : input.nativeTypeContext.callableValues.frames.entryFor(carrier);
  const frameCarriers = binding.entry === undefined ? undefined : rustNativeFrameCallableCarriers(carrier, input.nativeTypeContext);
  if (binding.entry !== undefined && (frameCarriers === undefined || entry !== binding.entry ||
    input.nativeTypeContext.callableValues.frames.definitionFor(carrier) !== definition))
    return reject("A native callable frame binding requires its exact selected entry and original environment application.");
  const payload = selectRustNativeTypeCarrier(frameCarriers?.entry ?? carrier,
    rustNativeTypeSelectionInput(input.nativeTypeContext), "general");
  if (payload.kind === "rejected") return reject(payload.reason);
  const read = frameCarriers === undefined ? payload
    : selectRustNativeTypeCarrier(frameCarriers.root, rustNativeTypeSelectionInput(input.nativeTypeContext), "general");
  if (read.kind === "rejected") return reject(read.reason);
  const nativeFrame = selectRustNativeTypeCarrier(frame, rustNativeTypeSelectionInput(input.nativeTypeContext), "general");
  if (nativeFrame.kind === "rejected") return reject(nativeFrame.reason);
  const storage = selectRustNativeBindingStorage({ kind: "frame", storage: binding.storage,
    initialization: binding.initialization, payloadCarrier: payload.carrier });
  const owner = Object.freeze({ kind: "frame" as const, declaration: definition.activation.ownerDeclaration,
    fieldName: binding.fieldName, ...selectRustNativeFrameStorageOwner(nativeFrame.carrier, definition.storage.kind) });
  return resolvedTargetStage(Object.freeze({ storage, readCarrier: read.carrier, owner }));
}
