import { createHash } from "node:crypto";
import { failTargetAnalysisInvariant, type TargetStageResult } from "@tsonic/target-api/artifacts";

import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, Node_Initializer, sourceBindingScope, type SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCallableOrigin, RustCallableSignature } from "../../../target-model/types/carriers/callable-signatures.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustCopyCarrier } from "../../../policy/constraints/native-traits.js";
import { rustCallableOrigin } from "../../../policy/types/callables/callable-origins.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";

import type { RustCallableOwnershipPlan } from "../ownership/ownership-plan.js";

import type { RustSourceCallableSpecializationIssue } from "../../../target-model/records/callable-issues.js";
import type { RustProjectTypePolicy } from "../../project-types/index.js";
import { validatedRustCapturedFieldStorageFact } from "../../storage/receiver-captures.js";
import type { RustObjectRepresentationPlan } from "../../project-types/object-representation.js";
import type { RustProjectConstructionPlan } from "../../project-types/construction-plan.js";
import { prepareRustRetainedFrameCounters } from "../storage/frame-counter-storage.js";

import type { RustFrameCallableImplementation, RustFrameCallableEntryDefinition, RustFrameCallableBinding,
  RustFrameCallableDefinition, RustFrameEntryErrorSelection } from "../../../target-model/records/frame-callables.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustStaticLifetime } from "../../../target-model/lifetimes/index.js";
import type { RustFrameNativeType } from "../../../target-model/records/frame-emission.js";
import type { RustClassValuePlan } from "../../../target-model/records/class-values.js";

export interface RustFrameCallablePlanRegistry extends RustFrameCallablePlan {
  nativeTypeFor(carrier: TargetTypeRef, classValues: Pick<RustClassValuePlan, "forDeclaration">): RustFrameNativeType | undefined;
  completeErrors(select: (definition: RustFrameCallableDefinition,
    entry: RustFrameCallableEntryDefinition) => TargetStageResult<RustFrameEntryErrorSelection>): readonly RustSourceCallableSpecializationIssue[];
  sealCounters(constructions: readonly RustProjectConstructionPlan[]): RustFrameCallablePlan;
}

export function rustFrameCallableEnvironmentBindings(
  definition: Pick<RustFrameCallableDefinition, "environmentParameters">,
  entry: Pick<RustFrameCallableEntryDefinition, "environmentIndexes">,
  environment: readonly TargetTypeRef[],
): ReadonlyMap<string, TargetTypeRef> | undefined {
  if (entry.environmentIndexes.length !== environment.length) return undefined;
  const bindings = new Map<string, TargetTypeRef>();
  for (const [index, value] of environment.entries()) {
    const parameter = definition.environmentParameters[entry.environmentIndexes[index]!];
    if (parameter === undefined) return undefined;
    const previous = bindings.get(parameter.identity);
    if (previous !== undefined && !rustTargetTypeRefEquals(previous, value)) return undefined;
    bindings.set(parameter.identity, value);
  }
  return bindings;
}

export function createRustFrameCallablePlan(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly ownership: RustCallableOwnershipPlan;
  readonly frameBindingCarriers: ReadonlyMap<Node, TargetTypeRef>;
  readonly sourceStorage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly usedNames: ReadonlySet<string>;
  readonly navigation: SourceProgramNavigation;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
}): RustFrameCallablePlanRegistry {
  const definitions: RustFrameCallableDefinition[] = [];
  const issues: RustSourceCallableSpecializationIssue[] = [];
  const byOwner = new Map<string, RustFrameCallableDefinition>();
  const byDeclaration = new Map<Node, RustFrameCallableDefinition>();
  const implementations = new Map<Node, RustFrameCallableImplementation>();
  const bindings = new Map<Node, RustFrameCallableBinding>();
  const usedNames = new Set(input.usedNames);
  const ownerKey = (owner: RustCallableOrigin): string => closedMetadataKey(owner);
  const signatureKey = (carrier: TargetTypeRef): string | undefined => {
    const value = rustFrameCallableValue(carrier);
    return value === undefined ? undefined : closedMetadataKey(value.signature);
  };
  const issue = (subject: Node, message: string): void => {
    issues.push(Object.freeze({ subject, message }));
  };
  for (const activation of input.ownership.activations) {
    const owner = rustCallableOrigin(input.ast, activation.activationScope);
    if (owner === undefined) {
      issue(activation.activationScope, "A native callable frame requires its exact authored activation identity.");
      continue;
    }
    const frameDeclarations = new Set(activation.slotDeclarations);
    const classDefinition = activation.kind !== "class" ? undefined : input.projectTypes.definitionForDeclaration(activation.ownerDeclaration);
    const classLayout = classDefinition === undefined ? undefined : input.projectTypes.objectLayoutForDefinition(classDefinition);
    if (activation.kind === "class" && (classDefinition?.kind !== "class" || classLayout?.kind !== "class")) {
      issue(activation.ownerDeclaration, "A class activation requires its exact native project owner and field layout.");
      continue;
    }
    const representation = classDefinition === undefined ? undefined : input.objectRepresentations.representationFor(classDefinition);
    if (classDefinition !== undefined && representation === undefined) {
      issue(activation.ownerDeclaration, "A class activation requires its sealed native object representation.");
      continue;
    }
    const standalone = classDefinition === undefined || representation?.kind === "value";
    if (!standalone) for (const field of classLayout?.fields ?? []) frameDeclarations.add(field.declaration);
    else if (classDefinition !== undefined) {
      for (const component of activation.components) {
        for (const capture of component.captures) if (capture.kind === "field") frameDeclarations.add(capture.declaration);
        for (const relation of component.receiverRelations) frameDeclarations.add(relation.storageDeclaration);
      }
    }
    if (activation.kind === "lexical") for (const capture of activation.externalCaptures) {
      if (capture.kind === "lexical" && sourceBindingScope(capture.declaration, input.ast) === activation.activationScope)
        frameDeclarations.add(capture.declaration);
    }
    const groups = new Map<string, { signature: RustCallableSignature; implementations: RustFrameCallableImplementation[] }>();
    const prefix = createHash("sha256").update(ownerKey(owner)).digest("hex").slice(0, 16);
    for (const declaration of activation.callableDeclarations) {
      const operation = input.records.targetOperation.get(declaration);
      const capture = input.records.closureCapture.get(declaration);
      const carrier = operation?.kind === "closure" ? operation.resultCarrier : undefined;
      const value = rustFrameCallableValue(carrier);
      if (carrier === undefined || capture === undefined || value === undefined ||
        ownerKey(value.owner.origin) !== ownerKey(owner)) {
        issue(declaration, "A native frame entry requires its finalized closure, exact activation carrier and capture evidence.");
        continue;
      }
      const key = signatureKey(carrier)!;
      let group = groups.get(key);
      if (group === undefined) {
        group = { signature: value.signature, implementations: [] };
        groups.set(key, group);
      }
      const identity = createHash("sha256").update(`${owner.fileName}:${input.ast.pos(declaration)}:${input.ast.end(declaration)}`).digest("hex").slice(0, 16);
      const entryCaptures = Object.freeze(capture.captures.filter(selected => !frameDeclarations.has(selected.declaration))
        .map(selected => Object.freeze({ ...selected, storageCarrier: selected.carrier })));
      const receiverFields = Object.freeze(capture.receiverFields.filter(selected => !frameDeclarations.has(selected.declaration))
        .map(selected => Object.freeze({ ...selected, storageCarrier: selected.carrier })));
      const receivers = Object.freeze(capture.receivers.filter(selected => selected.owner !== classDefinition?.declaration)
        .map(selected => Object.freeze({ ...selected, storageCarrier: selected.carrier })));
      const independent = input.ownership.isIndependentCallable(declaration);
      if (independent && (capture.captures.length !== 0 || capture.receiverFields.length !== 0 || capture.receivers.length !== 0)) {
        issue(declaration, "An independent frame alternative requires its exact capture-free environment.");
        continue;
      }
      const implementation = Object.freeze({ declaration, carrier, capture, captures: entryCaptures, receiverFields, receivers, independent,
        copy: receivers.length === 0 && receiverFields.every(selected => selected.storage.kind === "copy") &&
          entryCaptures.every(selected => selected.storage === "value" && isRustCopyCarrier(selected.carrier)),
        variantName: `Entry_${identity}`,
        functionName: allocateRustGeneratedName(usedNames, `tsonic_frame_entry_${prefix}_${identity}`),
        stateName: allocateRustGeneratedName(usedNames, `TsonicFrameState_${prefix}_${identity}`) });
      implementations.set(declaration, implementation);
      group.implementations.push(implementation);
    }
    const environmentParameters = Object.freeze([...new Map([...groups.values()].flatMap(group => group.implementations)
      .flatMap(implementation => rustFrameCallableValue(implementation.carrier)!.environment)
      .filter((parameter): parameter is Extract<TargetTypeRef, { readonly kind: "type-parameter" }> => parameter.kind === "type-parameter")
      .map(parameter => [parameter.identity, parameter])).values()]);
    const entries = Object.freeze([...groups].map(([key, group], index) => Object.freeze({
      key, targetName: allocateRustGeneratedName(usedNames, `TsonicFrameEntry_${prefix}_${index}`),
      signature: group.signature, implementations: Object.freeze(group.implementations),
      copy: group.implementations.every(implementation => implementation.copy && !implementation.independent),
      hasIndependent: group.implementations.some(implementation => implementation.independent),
      environmentIndexes: Object.freeze(rustFrameCallableValue(group.implementations[0]!.carrier)!.environment
        .map(parameter => parameter.kind === "type-parameter"
          ? environmentParameters.findIndex(candidate => candidate.identity === parameter.identity) : -1)),
    })));
    const frameBindings: RustFrameCallableBinding[] = [];
    const declarations = frameDeclarations;
    for (const declaration of declarations) {
      const carrier = activation.slotDeclarations.includes(declaration)
        ? input.frameBindingCarriers.get(declaration) : input.records.runtimeCarrier.get(declaration)?.carrier;
      const key = carrier === undefined ? undefined : signatureKey(carrier);
      const entry = key === undefined ? undefined : entries.find(candidate => candidate.key === key);
      if (carrier === undefined || activation.slotDeclarations.includes(declaration) && (entry === undefined ||
        entry.implementations.some(implementation => !rustTargetTypeRefEquals(implementation.carrier, carrier)))) {
        issue(declaration, "A native frame binding requires its exact selected carrier and closed entry protocol.");
        continue;
      }
      const classStorage = classDefinition === undefined ? undefined : validatedRustCapturedFieldStorageFact(declaration, input)?.storage;
      const lexicalStorage = classDefinition === undefined ? input.records.bindingStorage.get(declaration) : undefined;
      if (lexicalStorage !== undefined && !rustTargetTypeRefEquals(lexicalStorage.valueCarrier, carrier)) {
        issue(declaration, "A native frame binding differs from its sealed physical storage carrier.");
        continue;
      }
      if (classDefinition !== undefined && input.objectRepresentations.receiverCaptures.isCaptured(declaration) && classStorage === undefined) {
        issue(declaration, "A captured class frame field requires its sealed declaration-carrier storage fact.");
        continue;
      }
      const initialization = classDefinition !== undefined ? classStorage?.initialization === "deferred" ? "deferred" as const : "ready" as const
        : input.ast.is.IsParameterDeclaration(declaration) ? "ready" as const : "deferred" as const;
      const immutable = classDefinition === undefined ? !input.navigation.declarationUseSummary(declaration).bindingWritten
        : classStorage === undefined ? !input.navigation.declarationUseSummary(declaration).memberWritten
          : classStorage.kind === "shared" || classStorage.kind === "copy";
      const storage = selectRustFrameBindingStorage(Object.freeze({ entry, carrier,
        location: lexicalStorage?.storage === "location", standalone, mutableObject: representation?.mutable === true,
        immutable, classOwned: classDefinition !== undefined }));
      const fieldName = classDefinition === undefined ? `binding_${frameBindings.length}`
        : input.projectTypes.fieldStorageName(classDefinition, declaration);
      if (fieldName === undefined) {
        issue(declaration, "A class frame field requires its exact canonical storage name.");
        continue;
      }
      const binding = Object.freeze({ declaration, carrier, entry, initialization, storage, fieldName });
      bindings.set(declaration, binding);
      frameBindings.push(binding);
    }
    for (const implementation of entries.flatMap(entry => entry.implementations)) {
      for (const capture of implementation.capture.captures) {
        const binding = bindings.get(capture.declaration);
        if (binding !== undefined && !rustTargetTypeRefEquals(
          input.records.runtimeCarrier.get(binding.declaration)?.carrier, capture.carrier))
          issue(capture.reference, "A native frame capture differs from its selected activation binding carrier.");
      }
    }
    const constructionExposure = classLayout?.fields.flatMap(field => {
      const expression = Node_Initializer(input.ast, field.declaration);
      if (expression === undefined) return [];
      let direct: Node | undefined = expression;
      const visited = new Set<Node>();
      while (direct !== undefined && !visited.has(direct) && (input.ast.is.IsParenthesizedExpression(direct) ||
        input.ast.is.IsSatisfiesExpression(direct) || input.ast.is.IsNonNullExpression(direct))) {
        visited.add(direct);
        direct = Node_Expression(input.ast, direct);
      }
      if (direct !== undefined && implementations.has(direct)) return [];
      const creations = input.sourceStorage.localCallableCreationsFor(expression);
      return creations.kind !== "resolved" || creations.nodes.length === 0 ||
        !creations.nodes.every(node => {
          const implementation = implementations.get(node);
          return implementation !== undefined && entries.some(entry => entry.implementations.includes(implementation));
        }) ? [] : [Object.freeze({ declaration: field.declaration, expression })];
    })[0];
    const definition = Object.freeze({ activation, owner, ownerFileName: owner.fileName,
      storage: standalone ? Object.freeze({ kind: "standalone" as const,
        ...(classDefinition === undefined ? {} : { instanceFieldName: allocateRustGeneratedName(usedNames, `tsonic_frame_${prefix}`) }) })
        : Object.freeze({ kind: "object" as const, mutable: representation!.mutable }),
      counterName: classDefinition === undefined ? "counter" : allocateRustGeneratedName(usedNames, `tsonic_frame_counter_${prefix}`),
      targetName: allocateRustGeneratedName(usedNames, `TsonicCallableFrame_${prefix}`),
      entries, bindings: Object.freeze(frameBindings), environmentParameters,
      ...(constructionExposure === undefined ? {} : { constructionExposure }) });
    definitions.push(definition);
    byOwner.set(ownerKey(owner), definition);
    byDeclaration.set(activation.ownerDeclaration, definition);
  }
  const definitionFor = (carrier: TargetTypeRef): RustFrameCallableDefinition | undefined => {
    const value = rustFrameCallableValue(carrier);
    const definition = value === undefined ? undefined : byOwner.get(ownerKey(value.owner.origin));
    if (definition === undefined || value === undefined || value.owner.kind !== definition.activation.kind) return undefined;
    return value.owner.kind === "class" && input.projectTypes.definitionForCarrier(value.owner.instance)?.declaration !== definition.activation.ownerDeclaration
      ? undefined : definition;
  };
  const activationInput = (expression: Node, definition: RustFrameCallableDefinition): "independent" | "same" | undefined => {
    if (!definitions.includes(definition)) return undefined;
    const subject = input.sourceStorage.subject(expression, "value");
    const origins = subject.kind === "resolved" ? input.sourceStorage.closedOriginsFor(subject.subject) : subject;
    if (origins.kind === "complete" && origins.origins.length !== 0 && origins.origins.every(origin => {
      if (origin.subject.kind !== "value" || origin.subject.projection.length !== 0) return false;
      const implementation = implementations.get(origin.subject.node);
      return implementation?.independent === true && definition.entries.some(entry => entry.implementations.includes(implementation));
    })) return "independent";
    const creations = input.sourceStorage.localCallableCreationsFor(expression);
    if (creations.kind === "resolved" && creations.nodes.length !== 0) return creations.nodes.every(node => {
      const implementation = implementations.get(node);
      return implementation !== undefined && definition.entries.some(entry => entry.implementations.includes(implementation));
    }) ? "same" : undefined;
    const visited = new Set<Node>();
    let current: Node | undefined = expression;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const implementation = implementations.get(current);
      if (implementation !== undefined) return definition.entries.some(entry => entry.implementations.includes(implementation)) ? "same" : undefined;
      const kind = input.ast.kindName(current);
      if (kind === "KindParenthesizedExpression" || kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression") {
        current = Node_Expression(input.ast, current);
        continue;
      }
      if (kind !== "KindIdentifier") return undefined;
      const declaration = input.navigation.sourceReferenceFor(current)?.declaration;
      if (declaration === undefined) return undefined;
      if (definition.bindings.some(binding => binding.declaration === declaration && binding.entry !== undefined)) return "same";
      if (!input.ast.is.IsVariableDeclaration(declaration) || input.navigation.declarationUseSummary(declaration).bindingWritten) return undefined;
      let scope = sourceBindingScope(declaration, input.ast);
      const scopes = new Set<Node>();
      while (scope !== undefined && scope !== definition.activation.activationScope && !scopes.has(scope)) {
        scopes.add(scope);
        scope = input.ast.parent(scope);
      }
      if (scope !== definition.activation.activationScope) return undefined;
      current = Node_Initializer(input.ast, declaration);
    }
    return undefined;
  };
  const selectedDefinitions = new Map<string, RustFrameCallableDefinition>();
  type SelectedFrameCarrier = {
    readonly carrier: TargetTypeRef;
    readonly entry: RustFrameCallableEntryDefinition;
  } & ({ readonly kind: "pending" } | {
    readonly kind: "completed";
    readonly independentCarrier: TargetTypeRef | undefined;
  });
  const selectedEntries = new Map<string, SelectedFrameCarrier>();
  const activationInputs = new Map<Node, Map<RustFrameCallableDefinition, {
    readonly independent: boolean; readonly receiverOwner?: Node;
  }>>();
  const receiverOwners = new Map<Node, Node>();
  const prepareCarrier = (carrier: TargetTypeRef | undefined): RustFrameCallableDefinition | undefined => {
    if (carrier === undefined) return undefined;
    const definition = definitionFor(carrier);
    if (definition === undefined) return undefined;
    const key = closedMetadataKey(carrier);
    selectedDefinitions.set(key, definition);
    const signature = signatureKey(carrier);
    const entry = signature === undefined ? undefined : definition.entries.find(entry => entry.key === signature);
    if (entry !== undefined) selectedEntries.set(key, Object.freeze({ kind: "pending", carrier, entry }));
    return definition;
  };
  for (const definition of definitions) {
    for (const binding of definition.bindings) prepareCarrier(binding.carrier);
    for (const entry of definition.entries) for (const implementation of entry.implementations) prepareCarrier(implementation.carrier);
  }
  for (const node of input.nativeNodes) {
    const receiverOwner = input.ownership.instanceReceiverOwner(node);
    if (receiverOwner !== undefined) receiverOwners.set(node, receiverOwner);
    const declaration = input.records.sourceBinding.get(node)?.sourceDeclaration;
    const conversion = input.records.contextualValueConversion.get(node);
    const parent = input.ast.parent(node);
    const initializerBinding = parent === undefined || Node_Initializer(input.ast, parent) !== node ? undefined : bindings.get(parent);
    const candidates = new Set([input.records.runtimeCarrier.get(node)?.carrier, conversion?.targetCarrier,
      declaration === undefined ? undefined : bindings.get(declaration)?.carrier, initializerBinding?.carrier]
      .map(prepareCarrier).filter((definition): definition is RustFrameCallableDefinition => definition !== undefined));
    for (const definition of candidates) {
      const selectedInput = activationInput(node, definition);
      if (selectedInput === undefined) continue;
      const selected = activationInputs.get(node) ?? new Map<RustFrameCallableDefinition, {
        readonly independent: boolean; readonly receiverOwner?: Node;
      }>();
      selected.set(definition, Object.freeze({ independent: selectedInput === "independent",
        ...(definition.activation.kind === "class" ? { receiverOwner: definition.activation.ownerDeclaration } : {}) }));
      activationInputs.set(node, selected);
    }
  }
  let errors: ReadonlyMap<RustFrameCallableEntryDefinition, RustFrameEntryErrorSelection> | undefined;
  const entryErrors = (entry: RustFrameCallableEntryDefinition): RustFrameEntryErrorSelection => {
    const selected = errors?.get(entry);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A native frame error lookup requires its completed original entry selection.");
    return selected;
  };
  const producer = createRustFrameCallableRecords({
    definitions: Object.freeze(definitions), issues: Object.freeze(issues), activationInputs, receiverOwners,
    selectedDefinitions, byDeclaration, implementations, bindings, entryErrors,
    entryFor: carrier => selectedEntries.get(closedMetadataKey(carrier))?.entry,
    independentCarrierFor(carrier) {
      const selected = selectedEntries.get(closedMetadataKey(carrier));
      if (selected === undefined) return undefined;
      if (selected.kind !== "completed") failTargetAnalysisInvariant("tsonic-rust",
        "An independent frame construction requires its completed native entry contract.");
      return selected.independentCarrier;
    },
    errorFor(carrier) {
      const frame = rustFrameCallableValue(carrier);
      if (frame === undefined) return undefined;
      const entry = selectedEntries.get(closedMetadataKey(carrier))?.entry;
      const definition = selectedDefinitions.get(closedMetadataKey(carrier));
      const bindings = entry === undefined || definition === undefined ? undefined
        : rustFrameCallableEnvironmentBindings(definition, entry, frame.environment);
      if (entry === undefined || bindings === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A native frame error requires its exact admitted carrier and environment correspondence.");
      return substituteRustTargetGenerics(entryErrors(entry).carrier, bindings, new Map());
    },
  });
  const nativeTypes = new Map<string, RustFrameNativeType>();
  return Object.freeze({ ...producer.records,
    nativeTypeFor(carrier: TargetTypeRef, classValues: Pick<RustClassValuePlan, "forDeclaration">): RustFrameNativeType | undefined {
      const key = closedMetadataKey(carrier);
      const existing = nativeTypes.get(key);
      if (existing !== undefined) return existing;
      const value = rustFrameCallableValue(carrier);
      const definition = producer.records.definitionFor(carrier);
      const entry = producer.records.entryFor(carrier);
      if (value === undefined || definition === undefined || entry === undefined ||
        value.environment.length !== entry.environmentIndexes.length) return undefined;
      const bindings = rustFrameCallableEnvironmentBindings(definition, entry, value.environment);
      if (bindings === undefined) return undefined;
      const environment: TargetTypeRef[] = [];
      for (const parameter of definition.environmentParameters) {
        const selected = bindings.get(parameter.identity);
        if (selected === undefined) return undefined;
        environment.push(selected);
      }
      let owner: RustFrameNativeType["owner"];
      if (definition.storage.kind !== "standalone") {
        if (value.owner.kind !== "class" || definition.activation.kind !== "class") return undefined;
        const instance = value.owner.instance;
        const selected = input.projectTypes.definitionForCarrier(instance);
        const representation = input.objectRepresentations.representationFor(selected);
        if (selected?.kind !== "class" || selected.declaration !== definition.activation.ownerDeclaration || representation === undefined)
          return undefined;
        owner = Object.freeze({ instance, representation,
          environment: classValues.forDeclaration(selected.declaration)?.environment?.instancesUseEnvironment === true });
      }
      const selected = Object.freeze({ definition, entry, environment: Object.freeze(environment), owner });
      nativeTypes.set(key, selected);
      return selected;
    },
    completeErrors(select: Parameters<RustFrameCallablePlanRegistry["completeErrors"]>[0]) {
      if (errors !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native frame entry errors complete exactly once.");
      const selections = new Map<RustFrameCallableEntryDefinition, RustFrameEntryErrorSelection>();
      const rejected: RustSourceCallableSpecializationIssue[] = [];
      for (const definition of definitions) for (const entry of definition.entries) {
        const selected = select(definition, entry);
        if (selected.kind === "resolved") selections.set(entry, selected.value);
        else rejected.push(...selected.diagnostics.map(diagnostic => ({
          subject: diagnostic.sourceNode ?? definition.activation.ownerDeclaration, message: diagnostic.message,
        })));
      }
      if (rejected.length === 0) {
        errors = selections;
        for (const [key, selected] of selectedEntries) {
          let independentCarrier: TargetTypeRef | undefined;
          if (selected.entry.hasIndependent) {
            const protocol = rustCallableProtocol(selected.carrier);
            const error = producer.records.errorFor(selected.carrier);
            if (protocol === undefined || error === undefined) failTargetAnalysisInvariant("tsonic-rust",
              "An admitted independent frame entry requires its exact invocation protocol and completed native error.");
            independentCarrier = rustCallableTargetType(protocol.parameters, protocol.result, rustStaticLifetime, error);
          }
          selectedEntries.set(key, Object.freeze({ kind: "completed", carrier: selected.carrier,
            entry: selected.entry, independentCarrier }));
        }
      }
      return Object.freeze(rejected);
    },
    sealCounters(constructions: readonly RustProjectConstructionPlan[]): RustFrameCallablePlan {
      return producer.finalizeCounters(() => prepareRustRetainedFrameCounters(definitions, input.ast, constructions));
    },
  });
}

import type { RustFrameCallablePlan } from "../../../target-model/records/frame-callables.js";
import { createRustFrameCallableRecords } from "../../program/records/frame-callables.js";
import { selectRustFrameBindingStorage } from "../../../policy/ownership/frame-bindings.js";
