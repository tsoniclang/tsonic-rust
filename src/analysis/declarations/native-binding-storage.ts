import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustFrameCallableBinding, RustFrameCallableDefinition, RustFrameCallablePlan } from "../callables/frame-values.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeBindingStorage, RustNativeStorageBinding,
  RustNativeFrameBindingStorageCompletion, RustNativeFrameStorageOwner, RustNativeCaptureEnvironmentStorage,
  RustNativeCaptureEnvironmentBase }
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
import type { RustCallableEmissionPreparation, RustPhysicalEmissionContextPreparation } from "../callables/emission-contexts.js";
import type { RustNativeCaptureEnvironment, RustPreparedNativeCaptureInput, RustPreparedNativeStorageBindingRequest }
  from "../callables/emission-capture-environments.js";
import { completeRustNativeNamedCaptureEnvironment } from "../callables/emission-capture-environments.js";
import type { RustDeclarationGenericRequirementIndex } from "./generic-requirements.js";

export interface RustNativeBindingStoragePublicationInput {
  readonly ast: AstReader;
  readonly contextUse: TargetUseSiteRef;
  readonly requests: readonly RustPreparedNativeStorageBindingRequest[];
  readonly captureEnvironments: readonly {
    readonly input: RustPreparedNativeCaptureInput;
    readonly environment: RustNativeCaptureEnvironmentStorage;
  }[];
  readonly fieldBindings: readonly RustNativeStorageBinding[];
  readonly records: RustProgramRecords;
  readonly frames: RustFrameCallablePlan;
  readonly projectTypes: RustProjectTypePolicy;
  readonly nativeTypeContext: RustNativeTypeInputContext;
  readonly physicalCarrierFor: (request: RustPreparedNativeStorageBindingRequest) => TargetTypeRef | undefined;
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
  readonly nativeEnvironments: readonly RustNativeCaptureEnvironmentStorage[];
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
    const requests = context?.nativeBindingRequests.filter(selected => selected.source.kind !== "capture" &&
      selected.declaration === request.declaration);
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
  const nativeEnvironments: RustNativeCaptureEnvironmentStorage[] = [];
  for (const context of input.emission.contexts.contexts) {
    const captures = completeRustNativeCaptureEnvironments({ context, projectTypes: input.declarationInput.projectTypes,
      genericRequirements: input.declarationInput.genericRequirements,
      nativeTypeContext: input.nativeTypeContextFor(context.nativeOwnerFileName) });
    if (captures.kind === "rejected") return captures;
    const selected = publishRustNativeBindingStorage({ ast: input.declarationInput.ast,
      contextUse: context.use, requests: context.nativeBindingRequests,
      captureEnvironments: captures.value,
      fieldBindings: declarations.fieldBindings.filter(row => row.contextUse === context.use),
      records: input.declarationInput.records, frames: input.frames,
      projectTypes: input.declarationInput.projectTypes,
      nativeTypeContext: input.nativeTypeContextFor(context.nativeOwnerFileName),
      physicalCarrierFor: request => input.emission.contexts.carrierFor(request.use, request.physicalCarrier) });
    if (selected.kind === "rejected") return selected;
    nativeBindings.push(...selected.value);
    nativeEnvironments.push(...captures.value.map(row => row.environment));
  }
  return resolvedTargetStage(Object.freeze({ forms: declarations.forms, fieldBindings: declarations.fieldBindings,
    nativeBindings: Object.freeze(nativeBindings), nativeEnvironments: Object.freeze(nativeEnvironments) }));
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
    const capture = request.source.kind !== "capture" ? undefined : input.captureEnvironments.find(row =>
      request.source.kind === "capture" && row.input === request.source.input);
    if (request.source.kind === "capture" && (capture === undefined ||
      capture.environment.use !== input.contextUse || capture.environment.sourceBindings !== request.sourceBindings ||
      capture.input.slots[request.source.slotIndex]?.slot !== request.source.slot ||
      capture.environment.slots[request.source.slotIndex] !== request.source.slot))
      return reject(request.declaration, "A captured native slot requires its original complete environment, slot and correlated source bindings.");
    const previous = selected.find(row => request.source.kind === "capture"
      ? row.owner.kind === "capture" && row.owner.environment === capture?.environment &&
        row.owner.slotIndex === request.source.slotIndex
      : row.owner.kind !== "capture" && row.declaration === request.declaration);
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
        const slot = request.source.slot;
        if (capture === undefined || (slot.kind === "receiver" ? slot.capture.owner : slot.capture.declaration) !== request.declaration)
          return reject(request.declaration, "A native capture slot lost its original checked binding or receiver declaration.");
        storage = slot.kind === "binding" ? selectRustNativeBindingStorage({ kind: "binding", payloadCarrier: payload.carrier,
          storage: slot.capture.storage, initialization: request.source.initialization,
          nativeAllocation: input.records.nativeBacking.get(request.declaration) ?? null })
          : slot.kind === "receiver" ? selectRustNativeBindingStorage({ kind: "binding", storage: "value",
              initialization: "ready", payloadCarrier: payload.carrier, nativeAllocation: null })
            : slot.capture.storage.kind === "copy" ? selectRustNativeBindingStorage({ kind: "captured-field", storage: "copy",
                initialization: "ready", payloadCarrier: payload.carrier })
              : selectRustNativeBindingStorage({ kind: "captured-field", storage: slot.capture.storage.kind,
                  initialization: slot.capture.storage.initialization, payloadCarrier: payload.carrier });
        owner = Object.freeze({ kind: "capture", slotIndex: request.source.slotIndex, environment: capture.environment });
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
    const source = request.source.kind !== "capture" ? request.source : Object.freeze({ kind: "capture" as const,
      slot: request.source.slot, initialization: request.source.initialization });
    selected.push(Object.freeze({ use: request.use, declaration: request.declaration, logicalCarrier: request.logicalCarrier,
      physicalCarrier: request.physicalCarrier, sourceBindings: request.sourceBindings, source,
      contextUse: input.contextUse, storage, readCarrier, owner }));
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
  const frame = completeRustNativeFrameOwner(input);
  if (frame.kind === "rejected") return frame;
  const apply = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(carrier,
    sourceBindings.types, sourceBindings.lifetimes, sourceBindings.consts);
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
  const storage = selectRustNativeBindingStorage({ kind: "frame", storage: binding.storage,
    initialization: binding.initialization, payloadCarrier: payload.carrier });
  const owner = Object.freeze({ kind: "frame" as const, declaration: definition.activation.ownerDeclaration,
    fieldName: binding.fieldName, ...frame.value });
  return resolvedTargetStage(Object.freeze({ storage, readCarrier: read.carrier, owner }));
}

function completeRustNativeFrameOwner(input: {
  readonly definition: RustFrameCallableDefinition;
  readonly sourceBindings: RustTargetGenericBindings;
  readonly projectTypes: RustProjectTypePolicy;
  readonly nativeTypeContext: RustNativeTypeInputContext;
}): TargetStageResult<Pick<RustNativeFrameStorageOwner, "frameCarrier" | "holderCarrier" | "constructor">> {
  const reject = (message: string): ReturnType<typeof completeRustNativeFrameOwner> => rejectedTargetStage([{
    code: "RUST_NATIVE_FRAME_STORAGE_NOT_CLOSED", category: "error", source: "tsonic-rust",
    sourceNode: input.definition.activation.ownerDeclaration, message,
  }]);
  const { definition, sourceBindings } = input;
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
  const selected = selectRustNativeTypeCarrier(frame, rustNativeTypeSelectionInput(input.nativeTypeContext), "general");
  return selected.kind === "rejected" ? reject(selected.reason)
    : resolvedTargetStage(selectRustNativeFrameStorageOwner(selected.carrier, definition.storage.kind));
}

function completeRustNativeCaptureEndpoint(
  source: Extract<RustNativeCaptureEnvironment, { readonly kind: "native" | "lexical" }>,
  common: RustNativeCaptureEnvironmentBase,
): TargetStageResult<Extract<RustNativeCaptureEnvironmentStorage, { readonly kind: "native" | "lexical" }>> {
  const declaration = source.kind === "native" ? source.producer.declaration : source.declaration;
  const reject = (message: string): ReturnType<typeof completeRustNativeCaptureEndpoint> => rejectedTargetStage([{
    code: "RUST_NATIVE_STORAGE_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: declaration, message,
  }]);
  if (source.producer.declaration !== declaration || source.producer.parameterCarriers === undefined)
    return reject("A native capture endpoint requires its original complete physical parameter producer.");
  if (source.kind === "native") return resolvedTargetStage(Object.freeze({ ...common, kind: "native",
    producer: source.producer, declaration, bodyUse: common.use, creation: source.creation }));
  const endpoints: Extract<RustNativeCaptureEnvironmentStorage, { readonly kind: "lexical" }>["endpoints"][number][] = [];
  for (const slot of common.slots) {
    if (slot.kind === "receiver-field") endpoints.push(Object.freeze({ kind: "receiver-field", capture: slot.capture }));
    else if (slot.kind === "receiver") endpoints.push(Object.freeze({ kind: "receiver", capture: slot.capture }));
    else {
      const capture = slot.capture;
      const ordinal = source.lexical.captures.findIndex(value => value.declaration === capture.declaration && value.reference === capture.reference);
      if (ordinal < 0) return reject("A lexical capture parameter requires its original selected declaration, reference and capture ordinal.");
      endpoints.push(Object.freeze({ kind: "implicit-parameter", declaration: capture.declaration, reference: capture.reference,
        parameterIndex: source.producer.parameterCarriers.length + ordinal }));
    }
  }
  return resolvedTargetStage(Object.freeze({ ...common, kind: "lexical", declaration, endpoints: Object.freeze(endpoints) }));
}

function completeRustNativeCaptureEnvironments(input: {
  readonly context: RustPhysicalEmissionContextPreparation;
  readonly projectTypes: RustProjectTypePolicy;
  readonly genericRequirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">;
  readonly nativeTypeContext: RustNativeTypeInputContext;
}): TargetStageResult<RustNativeBindingStoragePublicationInput["captureEnvironments"]> {
  const completed: RustNativeBindingStoragePublicationInput["captureEnvironments"][number][] = [];
  const reject = (message: string): ReturnType<typeof completeRustNativeCaptureEnvironments> => rejectedTargetStage([{
    code: "RUST_NATIVE_STORAGE_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: input.context.declaration, message,
  }]);
  for (const prepared of input.context.nativeCaptureInputs) {
    const source = prepared.environment;
    if (prepared.slots.some((slot, index) => slot.slotIndex !== index) || completed.some(row =>
      sameCaptureEnvironment(row.input.environment, source)))
      return reject("A native capture environment requires its original complete ordered slots and one exact owner per physical context.");
    const common: RustNativeCaptureEnvironmentBase = Object.freeze({ use: input.context.use,
      nativeOwnerFileName: input.context.nativeOwnerFileName, sourceBindings: input.context.bindings,
      slots: Object.freeze(prepared.slots.map(row => row.slot)) });
    let environment: RustNativeCaptureEnvironmentStorage;
    if (source.kind === "native" || source.kind === "lexical") {
      const selected = completeRustNativeCaptureEndpoint(source, common);
      if (selected.kind === "rejected") return selected;
      environment = selected.value;
    } else {
      const selected = completeRustNativeNamedCaptureEnvironment(source, { bindings: input.context.bindings,
        nativeContext: input.nativeTypeContext, declarationGenericRequirements: input.genericRequirements });
      if (selected.kind === "rejected") return reject(selected.reason);
      if (source.kind === "frame") {
        const frame = completeRustNativeFrameOwner({ definition: source.definition, sourceBindings: input.context.bindings,
          projectTypes: input.projectTypes, nativeTypeContext: input.nativeTypeContext });
        if (frame.kind === "rejected") return frame;
        if (selected.kind === "none") {
          if (prepared.slots.length !== 0 || source.definition.environmentParameters.length !== 0)
            return reject("Only an actual empty nongeneric frame alternative has no emitted capture state.");
          environment = Object.freeze({ ...common, kind: "frame", definition: source.definition, entry: source.entry,
            implementation: source.implementation, arguments: Object.freeze([]), frame: frame.value,
            payload: Object.freeze({ kind: "none" }) });
        } else {
          if (selected.slotPaths.length !== prepared.slots.length)
            return reject("A native frame state requires every actual capture's original emitted field path.");
          environment = Object.freeze({ ...common, kind: "frame", definition: source.definition, entry: source.entry,
            implementation: source.implementation, arguments: selected.arguments, frame: frame.value,
            payload: Object.freeze({ kind: "named", stateCarrier: selected.stateCarrier, holderCarrier: selected.holderCarrier,
              constructor: selected.constructor, slotPaths: selected.slotPaths }) });
        }
      } else {
        if (selected.kind === "none" || selected.slotPaths.length !== prepared.slots.length)
          return reject("A native generic or suspended state requires its actual declared owner even when it has zero captured slots.");
        const storage = { stateCarrier: selected.stateCarrier, holderCarrier: selected.holderCarrier,
          constructor: selected.constructor, slotPaths: selected.slotPaths, arguments: selected.arguments };
        environment = source.kind === "generic" ? Object.freeze({ ...common, ...storage, kind: "generic",
          definition: source.definition, implementation: source.implementation, member: source.member })
          : Object.freeze({ ...common, ...storage, kind: "suspended", implementation: source.implementation });
      }
    }
    completed.push(Object.freeze({ input: prepared, environment }));
  }
  return resolvedTargetStage(Object.freeze(completed));
}

function sameCaptureEnvironment(left: RustNativeCaptureEnvironment, right: RustNativeCaptureEnvironment): boolean {
  if (left.kind === "generic" && right.kind === "generic") return left.definition === right.definition &&
    left.implementation === right.implementation && left.member === right.member;
  if (left.kind === "frame" && right.kind === "frame") return left.definition === right.definition &&
    left.entry === right.entry && left.implementation === right.implementation;
  if (left.kind === "suspended" && right.kind === "suspended") return left.implementation === right.implementation;
  if (left.kind === "lexical" && right.kind === "lexical") return left.declaration === right.declaration;
  return left.kind === "native" && right.kind === "native" && left.producer === right.producer &&
    (left.creation.kind === "definition" && right.creation.kind === "definition" ||
      left.creation.kind === "expression" && right.creation.kind === "expression" && left.creation.use === right.creation.use);
}
