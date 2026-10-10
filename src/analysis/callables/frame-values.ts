import { createHash } from "node:crypto";
import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, Node_Initializer, sourceBindingScope, type SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustCallableOrigin, RustCallableSignature } from "../../target-model/types/carriers/callable-signatures.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import { rustCallableOrigin } from "../../policy/types/callable-origins.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustBindingStorageFactKey, rustClosureCaptureFactKey, rustTargetOperationFactKey, type RustClosureCaptureFact } from "../facts/keys.js";
import type { RustCallableActivation, RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import { validatedRustCapturedFieldStorageFact } from "../facts/receiver-captures.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";

export interface RustFrameCallableImplementation {
  readonly declaration: Node;
  readonly carrier: TargetTypeRef;
  readonly capture: RustClosureCaptureFact;
  readonly variantName: string;
  readonly functionName: string;
  readonly stateName: string;
  readonly captures: RustClosureCaptureFact["captures"];
  readonly receiverFields: RustClosureCaptureFact["receiverFields"];
  readonly receivers: RustClosureCaptureFact["receivers"];
  readonly copy: boolean;
  readonly independent: boolean;
}

export interface RustFrameCallableEntryDefinition {
  readonly key: string;
  readonly targetName: string;
  readonly signature: RustCallableSignature;
  readonly implementations: readonly RustFrameCallableImplementation[];
  readonly copy: boolean;
  readonly environmentIndexes: readonly number[];
  readonly hasIndependent: boolean;
}

export interface RustFrameCallableBinding {
  readonly declaration: Node;
  readonly fieldName: string;
  readonly carrier: TargetTypeRef;
  readonly entry: RustFrameCallableEntryDefinition | undefined;
  readonly initialization: "ready" | "deferred";
  readonly storage: "value" | "location" | "cell" | "borrow-cell";
}

export interface RustFrameCallableDefinition {
  readonly activation: RustCallableActivation;
  readonly owner: RustCallableOrigin;
  readonly ownerFileName: string;
  readonly targetName: string;
  readonly counterName: string;
  readonly storage: { readonly kind: "standalone"; readonly instanceFieldName?: string }
    | { readonly kind: "object"; readonly mutable: boolean };
  readonly entries: readonly RustFrameCallableEntryDefinition[];
  readonly bindings: readonly RustFrameCallableBinding[];
  readonly environmentParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly constructionExposure?: { readonly declaration: Node; readonly expression: Node };
}

export interface RustFrameCallablePlan {
  readonly definitions: readonly RustFrameCallableDefinition[];
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  definitionFor(carrier: TargetTypeRef): RustFrameCallableDefinition | undefined;
  definitionForOwner(declaration: Node): RustFrameCallableDefinition | undefined;
  entryFor(carrier: TargetTypeRef): RustFrameCallableEntryDefinition | undefined;
  implementationFor(declaration: Node): RustFrameCallableImplementation | undefined;
  bindingFor(declaration: Node): RustFrameCallableBinding | undefined;
  isSameActivationInput(expression: Node, definition: RustFrameCallableDefinition, receiver?: Node): boolean;
}

export function createRustFrameCallablePlan(input: {
  readonly ast: AstReader;
  readonly facts: RustPlanQueries;
  readonly ownership: RustCallableOwnershipPlan;
  readonly sourceStorage: SourceStorageQueries;
  readonly usedNames: ReadonlySet<string>;
  readonly navigation: SourceProgramNavigation;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
}): RustFrameCallablePlan {
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
      const operation = input.facts.getFact(declaration, rustTargetOperationFactKey);
      const capture = input.facts.getFact(declaration, rustClosureCaptureFactKey);
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
      const entryCaptures = Object.freeze(capture.captures.filter(selected => !frameDeclarations.has(selected.declaration)));
      const receiverFields = Object.freeze(capture.receiverFields.filter(selected => !frameDeclarations.has(selected.declaration)));
      const receivers = Object.freeze(capture.receivers.filter(selected => selected.owner !== classDefinition?.declaration));
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
      const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
      const key = carrier === undefined ? undefined : signatureKey(carrier);
      const entry = key === undefined ? undefined : entries.find(candidate => candidate.key === key);
      if (carrier === undefined || activation.slotDeclarations.includes(declaration) && entry === undefined) {
        issue(declaration, "A native frame binding requires its exact selected carrier and closed entry protocol.");
        continue;
      }
      const classStorage = classDefinition === undefined ? undefined : validatedRustCapturedFieldStorageFact(declaration, input)?.storage;
      const lexicalStorage = classDefinition === undefined ? input.facts.getFact(declaration, rustBindingStorageFactKey) : undefined;
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
      const storage = entry === undefined && lexicalStorage?.storage === "location" ? "location" as const
        : !standalone && representation?.mutable === true || immutable && (classDefinition !== undefined || entry === undefined)
        ? "value" as const : entry?.copy === true || entry === undefined && isRustCopyCarrier(carrier)
          ? "cell" as const : "borrow-cell" as const;
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
        if (binding !== undefined && !rustTargetTypeRefEquals(binding.carrier, capture.carrier))
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
  const isSameActivationInput = (expression: Node, definition: RustFrameCallableDefinition, receiver?: Node): boolean => {
    if (!definitions.includes(definition)) return false;
    const subject = input.sourceStorage.subject(expression, "value");
    const origins = subject.kind === "resolved" ? input.sourceStorage.closedOriginsFor(subject.subject) : subject;
    if (origins.kind === "complete" && origins.origins.length !== 0 && origins.origins.every(origin => {
      if (origin.subject.kind !== "value" || origin.subject.projection.length !== 0) return false;
      const implementation = implementations.get(origin.subject.node);
      return implementation?.independent === true && definition.entries.some(entry => entry.implementations.includes(implementation));
    })) return true;
    if (definition.activation.kind === "class" && receiver !== undefined &&
      input.ownership.instanceReceiverOwner(receiver) !== definition.activation.ownerDeclaration) return false;
    const creations = input.sourceStorage.localCallableCreationsFor(expression);
    if (creations.kind === "resolved" && creations.nodes.length !== 0) return creations.nodes.every(node => {
      const implementation = implementations.get(node);
      return implementation !== undefined && definition.entries.some(entry => entry.implementations.includes(implementation));
    });
    const visited = new Set<Node>();
    let current: Node | undefined = expression;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const implementation = implementations.get(current);
      if (implementation !== undefined) return definition.entries.some(entry => entry.implementations.includes(implementation));
      const kind = input.ast.kindName(current);
      if (kind === "KindParenthesizedExpression" || kind === "KindSatisfiesExpression" || kind === "KindNonNullExpression") {
        current = Node_Expression(input.ast, current);
        continue;
      }
      if (kind !== "KindIdentifier") return false;
      const declaration = input.navigation.sourceReferenceFor(current)?.declaration;
      if (declaration === undefined) return false;
      if (definition.bindings.some(binding => binding.declaration === declaration && binding.entry !== undefined)) return true;
      if (!input.ast.is.IsVariableDeclaration(declaration) || input.navigation.declarationUseSummary(declaration).bindingWritten) return false;
      let scope = sourceBindingScope(declaration, input.ast);
      const scopes = new Set<Node>();
      while (scope !== undefined && scope !== definition.activation.activationScope && !scopes.has(scope)) {
        scopes.add(scope);
        scope = input.ast.parent(scope);
      }
      if (scope !== definition.activation.activationScope) return false;
      current = Node_Initializer(input.ast, declaration);
    }
    return false;
  };
  return Object.freeze({ definitions: Object.freeze(definitions), issues: Object.freeze(issues),
    definitionFor,
    definitionForOwner: (declaration: Node) => byDeclaration.get(declaration),
    entryFor(carrier: TargetTypeRef) {
      const key = signatureKey(carrier);
      return key === undefined ? undefined : definitionFor(carrier)?.entries.find(entry => entry.key === key);
    },
    implementationFor: (declaration: Node) => implementations.get(declaration),
    isSameActivationInput,
    bindingFor: (declaration: Node) => bindings.get(declaration),
  });
}
