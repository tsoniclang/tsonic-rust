import type { AstReader, Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { analyzeSourceGenericAdoption, sourceGenericAdoptionDiagnosticCode, sourceGenericAdoptionDiagnosticMessage,
  createSourceOwnershipQuery, createSourceStorageBudget, defaultSourceStorageLimits,
  type SourceOwnershipPremises, type SourceOwnershipUnresolved, type SourceRetentionSelection,
  type SourceStorageBindings, type SourceStorageProjection, type SourceStorageQueries, type SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceExpressionResultDisposition, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustPromiseResult, RustPromiseResults, RustPromiseResultUses } from "../../target-model/records/promise-results.js";
import { mapRustAwaitSelection, rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustLifetimesEqual, type RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import { classifyCarrierRequirements, rustFinalContractSupportsStatic,
  type RustStaticRequirementEvidence } from "../declarations/generic-carrier-requirements.js";
import type { AnalyzeRustDeclarationGenericRequirementsResult } from "../declarations/generic-requirements.js";
import type { RustGenericRequirement } from "../../target-model/records/generic-requirements.js";
import { rustEnclosingStorageContract } from "./storage-contracts.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";

import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { completeRustNativeCaptureCarrier } from "./native-captures.js";
import type { RustNativeCapturePlan } from "../../target-model/records/native-captures.js";
import type { RustErrorTypeContext } from "../errors/error-types.js";
import type { RustStructuralShapeField } from "../../target-model/records/structural-shapes.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustSourceTypeRegistry } from "../../policy/types/model/source-type-registry.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { isRustAbsenceCarrier, rustFixedArrayCarrierValue } from "../../target-model/types/carriers/native.js";
import { rustJsArrayLikeElementTargetType } from "../../target-model/types/carriers/js.js";
import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";

export function analyzeRustPromiseResultUses(ast: AstReader, nodes: readonly Node[]): RustPromiseResultUses {
  return new Map(nodes.filter(node => ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node))
    .map(node => [node, sourceExpressionResultDisposition(ast, node)]));
}

export function analyzeRustGenericAdoption(input: {
  readonly source: TargetSourceProgram;
  readonly projectRoot: string;
  readonly storage: SourceStorageQueries;
  readonly sourceLifetimes: RustLifetimeIndex;
}): readonly TargetDiagnostic[] {
  const adoption = analyzeSourceGenericAdoption({ source: input.source, projectRoot: input.projectRoot,
    nodes: input.storage.nodes, storage: input.storage, budget: createSourceStorageBudget(defaultSourceStorageLimits),
    exemptTypeParameter: parameter => input.sourceLifetimes.parameterFor(parameter)?.kind === "lifetime" });
  return Object.freeze(adoption.kind === "unresolved" ? [Object.freeze({ code: "RUST_ASYNC_RESULT_USE_NOT_PROVEN",
    category: "error" as const, source: "tsonic-rust", sourceNode: adoption.at, message: adoption.reason })]
    : adoption.issues.map(issue => Object.freeze({ code: sourceGenericAdoptionDiagnosticCode,
      category: "error" as const, source: "tsonic-rust", sourceNode: issue.site, sourceSpan: issue.sourceSpan,
      message: sourceGenericAdoptionDiagnosticMessage, evidence: issue.evidence })));
}

export function analyzeRustPromiseResults(input: {
  readonly ast: AstReader;
  readonly source: TargetSourceProgram;
  readonly genericAdoption: readonly TargetDiagnostic[];
  readonly storage: SourceStorageQueries;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly uses: RustPromiseResultUses;
  readonly definitions: RustTypeDefinitions;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly nativeCaptures: RustNativeCapturePlan;
  readonly errorTypes: RustErrorTypeContext;
  readonly sourceTypes: Pick<RustSourceTypeRegistry, "structuralObjectForType">;
  readonly native: Pick<RustNativeCallableInputPlan, "callFor">;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly requirements: AnalyzeRustDeclarationGenericRequirementsResult;
  readonly retentionIssues: readonly RustSourceCallableSpecializationIssue[];
  readonly families: Pick<RustSourceTypeFamilyRegistry, "implementation">;
  readonly evidence: Omit<RustStaticRequirementEvidence, "lifetimeContract">;
}): { readonly results: RustPromiseResults; readonly diagnostics: readonly TargetDiagnostic[] } {
  const results = new Map<Node, RustPromiseResult>();
  const diagnostics: TargetDiagnostic[] = [...input.genericAdoption];
  const budget = createSourceStorageBudget(defaultSourceStorageLimits);
  const unresolved = (at: Node, reason: string): SourceOwnershipUnresolved => Object.freeze({ kind: "unresolved", at, reason });
  const carrierFor = (subject: SourceStorageSubject, bindings: SourceStorageBindings): TargetTypeRef | SourceOwnershipUnresolved => {
    const logical = input.nativeStorage.logicalCarrierFor(subject, bindings);
    if (logical === undefined) return unresolved(subject.node, "Async retention requires its completed bound native storage carrier.");
    const selected = input.nativeStorage.boundSubjectFor(subject, logical, bindings);
    return selected.kind === "unresolved" ? unresolved(subject.node, selected.reason) : selected.carrier;
  };
  const methodCapturesFor = (subject: SourceStorageSubject, bindings: SourceStorageBindings,
    field: RustStructuralShapeField, storageIndex: number,
    nestedCaptures: (subject: SourceStorageSubject, bindings: SourceStorageBindings,
      carrier: TargetTypeRef) => TargetTypeRef | SourceOwnershipUnresolved): TargetTypeRef | SourceOwnershipUnresolved => {
    const selected = input.storage.storageProducersFor(subject, bindings);
    if (selected.kind !== "complete") return unresolved(subject.node, selected.kind === "unresolved" ? selected.reason
      : "Native structural retention requires its complete same-activation method producer domain.");
    if (selected.producers.length === 0) return unresolved(subject.node,
      "Native structural retention requires its nonempty actual method construction evidence.");
    const destination = field.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier;
    if (destination === undefined) return unresolved(subject.node, "A retained native method requires its completed physical destination.");
    const captures: TargetTypeRef[] = [];
    for (const producer of selected.producers) {
      if (!budget.step()) return unresolved(subject.node, budget.failure()!);
      const expression = producer.subject.node;
      if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0 || input.ast.body(expression) === undefined)
        return unresolved(subject.node, "A retained native method requires its original checked implementation and creation bindings.");
      const constructions = field.methodConstructions?.filter(construction => construction.expression === expression &&
        construction.storageIndex === storageIndex && rustTargetTypeRefEquals(construction.destinationCarrier, destination));
      if (constructions === undefined || constructions.length === 0) return unresolved(subject.node,
        "A retained native method has no identical frozen physical field-construction witness.");
      for (const construction of constructions) {
        if (!budget.step()) return unresolved(subject.node, budget.failure()!);
        const element = input.source.semantics.forNode(construction.property).operations.objectLiteralElement(construction.property);
        if (element?.element !== construction.property || element.objectLiteral !== construction.object)
          return unresolved(subject.node, "A retained native method lost its exact checked construction root and contribution.");
      }
      const owner = sourceEnclosingCallable(input.ast.parent(expression), input.ast);
      const generic = input.nativeStorage.genericBindingsFor(owner ?? expression, producer.bindings);
      if (generic.kind === "unresolved") return unresolved(subject.node, generic.reason);
      const physical = completeRustNativeCaptureCarrier(expression, input.nativeCaptures.forDeclaration(expression),
        generic.bindings, input.errorTypes);
      if (physical.kind === "unresolved") return unresolved(subject.node, physical.reason);
      const sourceCaptures = input.records.closureCapture.get(expression);
      if (sourceCaptures === undefined) return unresolved(subject.node,
        "A retained native method requires its identical completed source capture inventory.");
      const references = [...sourceCaptures.captures, ...sourceCaptures.receiverFields, ...sourceCaptures.receivers];
      if (physical.carrier.kind !== "tuple" || physical.carrier.elements.length !== references.length)
        return unresolved(subject.node, "A native capture tuple lost its exact source-to-physical component correspondence.");
      captures.push(physical.carrier);
      for (const [index, capture] of references.entries()) {
        if (!budget.step()) return unresolved(subject.node, budget.failure()!);
        const reference = input.storage.subjectFor(capture.reference);
        if (reference.kind === "unresolved") return unresolved(subject.node, reference.reason);
        const nested = nestedCaptures(reference.subject, producer.bindings, physical.carrier.elements[index]!);
        if (nested.kind === "unresolved") return nested;
        captures.push(nested);
      }
    }
    return Object.freeze({ kind: "tuple", elements: Object.freeze(captures) });
  };
  const containsMethods = (carrier: TargetTypeRef, at: Node,
    visited = new Set<TargetTypeRef>()): boolean | SourceOwnershipUnresolved => {
    if (!budget.step()) return unresolved(at, budget.failure()!);
    if (visited.has(carrier)) return false;
    visited.add(carrier);
    if (carrier.kind === "function-pointer" || carrier.kind === "closure" || rustCallableProtocol(carrier) !== undefined) return false;
    const structural = rustStructuralObjectCarrierValue(carrier);
    if (structural !== undefined) for (const [index, field] of structural.fields.entries()) {
      const physical = input.evidence.structuralShapes?.field(carrier, index);
      if (physical === undefined) return unresolved(at, "Native retention requires its complete structural field layout.");
      if (field.method === true && physical.nativeMethod !== true) return true;
    }
    for (const child of [...rustTargetTypeChildren(carrier, (_parent, _child, role) =>
      role.kind !== "structural-construction" && (role.kind !== "structural-field" || role.structural.fields[role.index]?.method !== true)),
      ...(input.definitions.sourceUnionVariants(carrier)?.map(variant => variant.carrier) ?? [])]) {
      const selected = containsMethods(child, at, visited);
      if (selected !== false) return selected;
    }
    return false;
  };
  const captureQueries: { readonly subject: SourceStorageSubject; readonly bindings: SourceStorageBindings }[] = [];
  const captureStorageFor = (subject: SourceStorageSubject, bindings: SourceStorageBindings,
    carrier: TargetTypeRef): TargetTypeRef | SourceOwnershipUnresolved => {
    const needed = containsMethods(carrier, subject.node);
    if (needed !== true) return needed === false ? Object.freeze({ kind: "tuple", elements: Object.freeze([]) }) : needed;
    if (captureQueries.some(current => current.subject === subject && current.bindings === bindings)) return unresolved(subject.node,
      "Native retained storage requires its completed correlated captured-value construction, not a cyclic signature assumption.");
    captureQueries.push({ subject, bindings });
    try {
      const selected = input.storage.storageProducersFor(subject, bindings);
      if (selected.kind !== "complete") return unresolved(subject.node, selected.kind === "unresolved" ? selected.reason
        : "Native aggregate retention requires its complete same-activation construction domain.");
      if (selected.producers.length === 0) return unresolved(subject.node,
        "Native aggregate retention requires its nonempty actual physical construction evidence.");
      const captures: TargetTypeRef[] = [];
      const project = (value: SourceStorageSubject, bindings: SourceStorageBindings, component: SourceStorageProjection,
        carrier: TargetTypeRef): SourceOwnershipUnresolved | undefined => {
        if (!budget.step()) return unresolved(value.node, budget.failure()!);
        const selected = input.storage.subject(value.node, value.kind, [...value.projection, component]);
        if (selected.kind === "unresolved") return unresolved(value.node, selected.reason);
        const nested = captureStorageFor(selected.subject, bindings, carrier);
        if (nested.kind === "unresolved") return nested;
        captures.push(nested);
        return undefined;
      };
      for (const producer of selected.producers) {
        if (!budget.step()) return unresolved(subject.node, budget.failure()!);
        const actual = carrierFor(producer.subject, producer.bindings);
        if (actual.kind === "unresolved") return actual;
        const present = rustOptionElementCarrier(carrier);
        const alternatives = rustUnionAlternatives(carrier, input.definitions);
        const expected = present !== undefined && (rustTargetTypeRefEquals(actual, present) || isRustAbsenceCarrier(actual)) ||
          alternatives?.some(variant => rustTargetTypeRefEquals(variant.carrier, actual)) === true ||
          rustTargetTypeRefEquals(carrier, actual);
        if (!expected) return unresolved(subject.node,
          "Native aggregate retention lost its exact selected source-to-physical construction correspondence.");
        const needsActual = containsMethods(actual, producer.subject.node);
        if (needsActual !== true) {
          if (needsActual !== false) return needsActual;
          continue;
        }
        const element = actual.kind === "array" || actual.kind === "slice" ? actual.element
          : rustFixedArrayCarrierValue(actual)?.element ?? rustJsArrayLikeElementTargetType(actual);
        if (element !== undefined) {
          const failure = project(producer.subject, producer.bindings, { kind: "array-element" }, element);
          if (failure !== undefined) return failure;
          continue;
        }
        if (actual.kind === "tuple") {
          for (const [index, element] of actual.elements.entries()) {
            const failure = project(producer.subject, producer.bindings, { kind: "tuple-element", index }, element);
            if (failure !== undefined) return failure;
          }
          continue;
        }
        const structural = rustStructuralObjectCarrierValue(actual);
        if (structural === undefined) return unresolved(subject.node,
          "A retained native captured aggregate requires its existing checked component-storage projection.");
        const semantics = input.source.semantics.forFile(producer.sourceFile);
        const checked = semantics.types.nonNullableType(producer.type);
        const template = checked === undefined ? undefined : input.sourceTypes.structuralObjectForType(checked);
        if (template === undefined) return unresolved(subject.node,
          "Native structural retention requires its one registered checked source template.");
        const owner = sourceEnclosingCallable(input.ast.parent(producer.subject.node), input.ast);
        const generic = input.nativeStorage.genericBindingsFor(owner ?? producer.subject.node, producer.bindings);
        if (generic.kind === "unresolved") return unresolved(subject.node, generic.reason);
        const bound = substituteRustTargetGenerics(template.carrier, generic.bindings.types,
          generic.bindings.lifetimes, generic.bindings.consts);
        const layout = rustStructuralObjectCarrierValue(bound);
        const shapes = input.evidence.structuralShapes;
        if (layout === undefined || shapes === undefined || !shapes.sharesStorage(bound, actual) ||
          template.storage !== "structural-object" || template.fields.length !== structural.fields.length ||
          layout.fields.length !== structural.fields.length) return unresolved(subject.node,
          "Native structural retention lost its exact bound canonical template and physical field layout.");
        const indexes = new Set<number>();
        for (const sourceField of template.fields) {
          if (!budget.step()) return unresolved(subject.node, budget.failure()!);
          const index = sourceField.storageIndex;
          const sourceCarrier = substituteRustTargetGenerics(sourceField.resultCarrier, generic.bindings.types,
            generic.bindings.lifetimes, generic.bindings.consts);
          const declared = layout.fields[index];
          const actualField = structural.fields[index];
          const physical = shapes.field(actual, index);
          if (!Number.isSafeInteger(index) || index < 0 || indexes.has(index) || declared === undefined || actualField === undefined ||
            physical === undefined || sourceField.declarations.length === 0 ||
            !rustTargetTypeRefEquals(sourceCarrier, declared.type) || !rustTargetTypeRefEquals(declared.type, actualField.type) ||
            !rustTargetTypeRefEquals(physical.carrier, actualField.type) || sourceField.sourceName !== actualField.sourceName ||
            declared.sourceName !== actualField.sourceName || physical.sourceName !== actualField.sourceName ||
            sourceField.method !== actualField.method || sourceField.presence !== actualField.presence ||
            sourceField.readonly !== actualField.readonly || physical.presence !== actualField.presence ||
            physical.readonly !== actualField.readonly || physical.method !== actualField.method)
            return unresolved(subject.node, "Native structural retention requires every exact source declaration, storage index and field carrier.");
          indexes.add(index);
          for (const declaration of sourceField.declarations) {
            const component: SourceStorageProjection = { kind: sourceField.method === true ? "method-value" : "member", declaration };
            if (sourceField.method === true && physical.nativeMethod !== true) {
              const selected = input.storage.subject(producer.subject.node, producer.subject.kind,
                [...producer.subject.projection, component]);
              if (selected.kind === "unresolved") return unresolved(subject.node, selected.reason);
              const nested = methodCapturesFor(selected.subject, producer.bindings, physical, index, captureStorageFor);
              if (nested.kind === "unresolved") return nested;
              captures.push(nested);
            } else if (physical.storage === "stored" && sourceField.method !== true) {
              const failure = project(producer.subject, producer.bindings, component, actualField.type);
              if (failure !== undefined) return failure;
            } else if (sourceField.method !== true) {
              const nested = containsMethods(actualField.type, producer.subject.node);
              if (nested !== false) return nested === true ? unresolved(subject.node,
                "A retained computed structural field requires its completed physical captured-storage correspondence.") : nested;
            }
          }
        }
      }
      return Object.freeze({ kind: "tuple", elements: Object.freeze(captures) });
    } finally {
      captureQueries.pop();
    }
  };
  const retainedCarrierFor = (subject: SourceStorageSubject, bindings: SourceStorageBindings): TargetTypeRef | SourceOwnershipUnresolved => {
    const carrier = carrierFor(subject, bindings);
    if (carrier.kind === "unresolved") return carrier;
    const captures = captureStorageFor(subject, bindings, carrier);
    return captures.kind === "unresolved" ? captures
      : Object.freeze({ kind: "tuple", elements: Object.freeze([carrier, captures]) });
  };
  const retentionFor: SourceOwnershipPremises["retentionFor"] = (value, bindings) => {
    if (!budget.step()) return unresolved(value.node, budget.failure()!);
    const checked = input.storage.typeFor(value);
    if (checked.kind === "unresolved") return unresolved(value.node, checked.reason);
    const evidence = { value, contractDeclaration: value.node, checkedType: checked.type };
    const operation = value.projection.length === 0 ? input.records.targetOperation.get(value.node) : undefined;
    if (operation?.kind === "reference-operation" &&
      (operation.operation === "shared-reference" || operation.operation === "mutable-reference")) {
      const owner = input.storage.subjectFor(operation.operandExpression);
      if (owner.kind === "unresolved") return unresolved(value.node, owner.reason);
      const region = input.storage.enclosingRegionFor(owner.subject.node);
      if (region === undefined) return unresolved(value.node, "A native source reference requires its actual owner's checked execution region.");
      return Object.freeze({ kind: "resolved", premises: Object.freeze([input.ast.is.IsSourceFile(region)
        ? Object.freeze({ ...evidence, kind: "retained", reason: "module-owner" })
        : Object.freeze({ ...evidence, kind: "scoped-borrowed", owner: owner.subject, region,
          mode: operation.operation === "shared-reference" ? "shared" : "mutable" })]) });
    }
    const carrier = carrierFor(value, bindings);
    if (carrier.kind === "unresolved") return carrier;
    const owner = value.kind === "receiver" ? value.node : value.kind === "input"
      ? input.ast.parent(value.node) : sourceEnclosingCallable(value.node, input.ast);
    if (carrier.kind === "reference" && carrier.lifetime?.kind !== "static") {
      const lifetime = carrier.lifetime;
      if (lifetime === undefined) return unresolved(value.node, "A retained native reference requires its completed physical lifetime evidence.");
      if (owner === undefined || value.kind !== "receiver" &&
        (value.kind !== "input" || !input.ast.parameters(owner).includes(value.node))) {
        return unresolved(value.node, "A retained native reference requires its concrete source owner or exact formal input contract.");
      }
      const abi = value.kind === "input" ? input.records.sourceParameterAbi.get(value.node) : undefined;
      if (value.kind === "input" && abi?.parameterCarrier.kind === "reference" && abi.inputLifetime !== undefined &&
        rustLifetimesEqual(lifetime, abi.inputLifetime) &&
        rustLifetimesEqual(abi.parameterCarrier.lifetime, abi.inputLifetime)) {
        return Object.freeze({ kind: "resolved", premises: Object.freeze([Object.freeze({ ...evidence,
          kind: "formal-borrowed", executionOwner: owner, mode: carrier.mutable ? "mutable" : "shared",
          region: Object.freeze({ kind: "input-duration", parameter: value.node }) })]) });
      }
      const semantics = input.source.semantics.forNode(value.node);
      for (const binding of semantics.types.typeArgumentBindings(checked.type) ?? []) {
        const symbol = semantics.declarations.typeSymbol(binding.argumentType);
        for (const declaration of symbol === undefined ? [] : semantics.declarations.symbolDeclarations(symbol)) {
          const parameter = input.sourceLifetimes.parameterFor(declaration);
          if (parameter?.kind !== "lifetime" || !rustLifetimesEqual(parameter.lifetime, lifetime)) continue;
          return Object.freeze({ kind: "resolved", premises: Object.freeze([Object.freeze({ ...evidence,
            kind: "formal-borrowed", executionOwner: owner, mode: carrier.mutable ? "mutable" : "shared",
            region: Object.freeze({ kind: "type-argument", binding, declaration }) })]) });
        }
      }
      return unresolved(value.node, "The actual native reference has no corresponding checked formal region argument.");
    }
    const active = new Map<SourceStorageSubject, Set<SourceStorageBindings>>();
    const classify = (carrier: TargetTypeRef, owner: Node | undefined): ReturnType<typeof classifyCarrierRequirements> => {
      const nativeEvidence = { ...input.evidence,
        lifetimeContract: rustEnclosingStorageContract(owner ?? value.node, input.ast, input.sourceLifetimes) };
      if (rustTargetTypeParameterIdentities(carrier).length === 0) return classifyCarrierRequirements(carrier, ["static"],
        new Set<string>(), new Map<string, Set<RustGenericRequirement>>(), () => false, input.definitions, nativeEvidence);
      const contract = input.requirements.kind === "resolved" && owner !== undefined
        ? input.requirements.index.contractFor(owner) : undefined;
      return contract === undefined ? { kind: "unresolved", reason: "Native generic retention requires its actual completed final contract." }
        : rustFinalContractSupportsStatic(contract, carrier, input.families, input.definitions, nativeEvidence);
    };
    const classifyExecution = (subject: SourceStorageSubject, bindings: SourceStorageBindings): ReturnType<typeof classify> => {
      if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
      const physical = retainedCarrierFor(subject, bindings);
      if (physical.kind === "unresolved") return physical;
      const executionOwner = subject.kind === "receiver" ? subject.node : subject.kind === "input"
        ? input.ast.parent(subject.node) : sourceEnclosingCallable(subject.node, input.ast);
      const direct = classify(physical, executionOwner);
      if (direct.kind === "supported" || executionOwner === undefined || rustTargetTypeParameterIdentities(physical).length === 0) return direct;
      const inProgress = active.get(subject) ?? new Set<SourceStorageBindings>();
      if (inProgress.has(bindings)) return { kind: "unresolved",
        reason: "Native result retention requires a complete actual generic execution contract, not a cyclic caller assumption." };
      inProgress.add(bindings);
      active.set(subject, inProgress);
      try {
        const selected = input.storage.boundActivationsFor(executionOwner, bindings);
        if (selected.kind === "unresolved") return selected;
        if (selected.activations.length === 0) return { kind: "unresolved",
          reason: "Native generic result retention requires its nonempty checked execution activation." };
        for (const activation of selected.activations) {
          if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
          if (activation.declaration !== executionOwner) return { kind: "unresolved",
            reason: "A native result execution contract must belong to its exact checked declaration." };
          const actual = retainedCarrierFor(subject, activation.bindings);
          if (actual.kind === "unresolved") return actual;
          const caller = activation.kind === "invocation" ? sourceEnclosingCallable(activation.invocation, input.ast) : executionOwner;
          const selection = classify(actual, caller);
          if (selection.kind === "supported") continue;
          if (activation.kind === "declaration" || rustTargetTypeParameterIdentities(actual).length === 0) return selection;
          const origins = input.storage.boundOriginsFor(subject, activation.bindings);
          if (origins.kind === "unresolved") return origins;
          if (origins.subjects.length === 0) return { kind: "unresolved",
            reason: "Native generic retention requires every actual argument's nonempty physical origin selection." };
          for (const origin of origins.subjects) {
            const retained = classifyExecution(origin, activation.callerBindings);
            if (retained.kind !== "supported") return retained;
          }
        }
        return { kind: "supported" };
      } finally {
        inProgress.delete(bindings);
      }
    };
    const staticStorage = classifyExecution(value, bindings);
    if (staticStorage.kind !== "supported") return unresolved(value.node, staticStorage.reason);
    const selection: SourceRetentionSelection = Object.freeze({ kind: "resolved",
      premises: Object.freeze([Object.freeze({ ...evidence, kind: "retained", reason: "owned-value" })]) });
    return selection;
  };
  const premises: SourceOwnershipPremises = {
    retentionFor,
    completionFor(call, selected) {
      const declaration = input.source.semantics.forNode(call).declarations.signatureDeclaration(selected.selectedSignature);
      if (declaration === undefined) return unresolved(call, "Async result-use requires its exact checked source signature.");
      const operation = input.records.targetOperation.get(call);
      const carrier = operation?.kind === "source-call" && operation.asyncBody !== undefined
        ? operation.asyncBody.logicalResultCarrier : rustEffectiveValueCarrier(input.records, call);
      const selection = rustAwaitSelection(carrier, input.definitions);
      if (selection === undefined) return unresolved(call, "Async result-use requires its completed native completion carrier.");
      const futures = rustAwaitSelectionLeaves(selection).flatMap(leaf => leaf.future === undefined ? [] : [leaf.future]);
      return futures.length === 0 ? { kind: "not-async" }
        : { kind: "async", contractDeclaration: declaration, checkedType: selected.sourceResultType,
          resultPolicy: futures.every(future => rustJsPromiseOutputTargetType(future.futureCarrier) !== undefined)
            ? "observe-rejection" : "must-observe" };
    },
    suspensionFor(value, bindings) {
      const isCall = input.ast.is.IsCallExpression(value.node) || input.ast.is.IsNewExpression(value.node);
      const operation = input.records.targetOperation.get(value.node);
      const selected = isCall ? input.source.semantics.forNode(value.node).operations.call(value.node) : undefined;
      const declaration = selected?.sourceSelectedSignatureKind === "resolved"
        ? input.source.semantics.forNode(value.node).declarations.signatureDeclaration(selected.selectedSignature) : undefined;
      if (isCall && declaration !== undefined && input.ast.body(declaration) !== undefined) return undefined;
      const checked = input.storage.typeFor(value);
      if (checked.kind === "unresolved") return unresolved(value.node, checked.reason);
      const completion = value.kind === "return" && value.projection.length === 0
        ? input.records.asyncFunction.get(value.node) : undefined;
      if (completion?.kind === "js-promise") return Object.freeze({
        kind: completion.lowering.kind === "settled" ? "never" : "may-suspend", value,
        contractDeclaration: value.node, checkedType: checked.type });
      const carrier = input.nativeStorage.logicalCarrierFor(value, bindings);
      if (carrier === undefined) return unresolved(value.node,
        "A native continuation requires its completed checked logical completion contract.");
      const awaited = rustAwaitSelection(carrier, input.definitions);
      if (awaited === undefined) return undefined;
      const future = rustAwaitSelectionLeaves(awaited).some(leaf => leaf.future !== undefined);
      const nativeCall = input.native.callFor(value.node);
      const nativeOperation = operation?.kind === "provider-operation" || operation?.kind === "reference-operation" ||
        operation?.kind === "flow-marker" || operation?.kind === "typed-location";
      if (isCall && nativeCall === undefined && !nativeOperation) return undefined;
      return Object.freeze({ kind: future ? "may-suspend" : "never", value,
        contractDeclaration: declaration ?? value.node, checkedType: checked.type });
    },
  };
  const ownership = createSourceOwnershipQuery({ source: input.source, storage: input.storage, budget, premises });
  for (const node of input.nodes) {
    if (!input.ast.is.IsCallExpression(node) && !input.ast.is.IsNewExpression(node)) continue;
    const selection = rustAwaitSelection(rustEffectiveValueCarrier(input.records, node), input.definitions);
    if (selection === undefined) continue;
    const leaves = rustAwaitSelectionLeaves(selection);
    if (!leaves.some(leaf => leaf.future !== undefined)) continue;
    const disposition = input.uses.get(node);
    if (disposition === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An indexed async producer requires its original source result-use selection.", node);
    const native = leaves.some(leaf => leaf.future !== undefined &&
      rustJsPromiseOutputTargetType(leaf.future.futureCarrier) === undefined);
    if (input.ast.is.IsCallExpression(node) && (!native || disposition.kind === "discarded")) {
      const selected = ownership.forCall(node);
      if (selected.kind === "unresolved") {
        if (input.requirements.kind === "resolved" && input.retentionIssues.length === 0)
          diagnostics.push(Object.freeze({ code: "RUST_ASYNC_RESULT_USE_NOT_PROVEN", category: "error", source: "tsonic-rust",
            sourceNode: node, message: selected.reason, evidence: ["target.capability=rust.async.native-result-use"] }));
        continue;
      }
      if (selected.kind === "resolved" && selected.decision === "rejected") {
        diagnostics.push(Object.freeze({ code: selected.diagnostic.code, category: "error", source: "tsonic-rust",
          sourceNode: node, message: selected.diagnostic.message, evidence: ["target.capability=rust.async.native-result-use"] }));
        continue;
      }
    }
    const discard = disposition.kind === "discarded" && !native
      ? mapRustAwaitSelection(selection, leaf => Object.freeze({ observe: leaf.future !== undefined })) : undefined;
    results.set(node, Object.freeze({ disposition, ...(discard === undefined ? {} : { discard }) }));
  }
  return Object.freeze({ results, diagnostics: Object.freeze(diagnostics) });
}
