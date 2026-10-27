import type { AstReader, Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { TargetSourcePackageGraph } from "@tsonic/target-api";
import type { SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity, Node_Expression, IsTypeSyntaxNode, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableInputProtocol, rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustCallableTargetId, rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustGenericCallableProtocol, rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustCallableInvocationSignaturesMatch } from "../../policy/conversions/callable-input.js";

import { isRustNeverCarrier, rustJsArrayLikeElementTargetType } from "../../target-model/types/carriers/js.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { createRustNativeCallableProtocolRegistry } from "./native-protocols.js";
import type { RustNativeCallableProtocol } from "../../target-model/records/native-protocols.js";
import { rustNativeCallableErrorType } from "../../policy/types/callables/native-protocols.js";
import { rustNativeCallableCompletion } from "../../policy/types/callables/native-completion.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustNativeCallableInvocationArguments } from "../../policy/types/callables/native-invocations.js";
import { rustJsPromiseOutputTargetType } from "../../target-model/types/carriers/promises.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/error-effects.js";

import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";

import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustNativeGenericProducerPlan } from "../../target-model/records/native-generic-producers.js";
import type { RustRetainedCallableInputPlan } from "../../target-model/records/retained-inputs.js";
import { rustNativeCallableInputPhysicalSignature } from "../../policy/conversions/native-callables.js";
import { emissionDiagnostic } from "./emission-contexts.js";

import type { RustNativeCallableInput, RustNativeCallableCall } from "../../target-model/records/native-protocols.js";

import type { RustNativeCallableGenericContext, RustNativeCallableGenericInput } from "../../target-model/records/native-generics.js";
import type { RustNativeGenericProducer } from "../program/records/native-generics.js";
import { rustNodeInCatchingTryBody } from "../errors/catching-try.js";
import { rustProgramErrorTargetType } from "../../target-model/types/carriers/js.js";
import type { RustCallableEntryConstruction } from "./entry-parameters.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustStructuralShapePlanRegistry } from "../objects/shapes/structural-shape-registry.js";
import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import { rustNativeStorageProjectionDepth, rustNativeStorageProjectionSteps } from "./native-storage-generics.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export type RustNativeCallableOrigins =
  | { readonly kind: "resolved"; readonly inputs: readonly RustNativeCallableInput[];
      readonly implementations: readonly SourceStorageSubject[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustNativeCallableInputPlan {
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  readonly inputs: readonly RustNativeCallableInput[];
  readonly protocols: readonly RustNativeCallableProtocol[];
  readonly calls: readonly RustNativeCallableCall[];
  callFor(node: Node): RustNativeCallableCall | undefined;
  inputsFor(declaration: Node): readonly RustNativeCallableInput[];
  capturesFor(declaration: Node): readonly RustNativeCallableInput[];
  originsFor(declaration: Node, subject: SourceStorageSubject, carrier: TargetTypeRef): RustNativeCallableOrigins;
  originsForValue(node: Node): RustNativeCallableOrigins;
  bindingsFor(declaration: Node): SourceStorageBindings | undefined;
  protocolForSourceItem(fileName: string, typeName: string): RustNativeCallableProtocol | undefined;
  /** Whether a callable parameter keeps its concrete callable carrier because its owner is emitted as a closure value. */
  isConcreteCallableParameter(parameter: Node): boolean;
  isConcreteCallableStorage(subject: SourceStorageSubject): boolean | undefined;
  /** Whether a callable parameter is retained by native code in its concrete runtime representation. */
  isNativeRetainedParameter(parameter: Node): boolean;
}

export function createRustNativeCallableInputPlan(input: {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly projectTypes: RustProjectTypePolicy;
  readonly structuralShapes: Pick<RustStructuralShapePlanRegistry, "definitionForCarrier" | "field" | "instantiateSourceCarrier">;
  readonly sourcePackages: TargetSourcePackageGraph;
  readonly usedNames: Set<string>;
  /**
   * Whether a callable owner is emitted as a native item (function, method, constructor, accessor, lexical function or
   * generic callable implementation) that can declare generic callable inputs. Owners emitted as closure values cannot
   * declare type parameters, so their callable parameters keep their concrete callable carrier.
   */
  readonly declaresGenericInputs: (owner: Node) => boolean;
  /** Whether a parameter is retained by a synchronous declaration whose nominal record result owns it ('static). */
  readonly ownedRetainedParameter: (parameter: Node) => boolean;
}): RustNativeCallableInputPlan {
  const registry = createRustNativeCallableProtocolRegistry(input);
  const componentByFile = new Map(input.sourcePackages.packages.flatMap(entry =>
    entry.sourceFiles.map(fileName => [fileName, entry.componentId] as const)));
  const ownerByComponent = new Map<string, string>();
  for (const fileName of input.storage.sourceFiles.map(file => input.ast.getFileName(file)).sort()) {
    const component = componentByFile.get(fileName);
    if (component !== undefined && !ownerByComponent.has(component)) ownerByComponent.set(component, fileName);
  }
  // A callable parameter passed unconverted into a native member parameter that takes a concrete runtime callable is
  // retained by native code in that exact representation: it keeps its concrete callable carrier.
  const nativeRetainedParameters = new Set<Node>();
  for (const node of input.nativeNodes) {
    if (!input.ast.is.IsCallExpression(node) || input.records.targetOperation.get(node)?.kind === "source-call") continue;
    const formals = input.records.selectedCall.get(node)?.member.parameters;
    if (formals === undefined) continue;
    for (const [index, argument] of input.ast.arguments(node).entries()) {
      const formal = formals[index]?.type;
      if (argument === undefined || formal === undefined) continue;
      const element = rustOptionElementCarrier(formal) ?? formal;
      const runtimeCallable = element.kind === "target-named" && element.id === rustCallableTargetId;
      if (!runtimeCallable && (rustCallableProtocol(element) === undefined || rustGenericCallableProtocol(element) !== undefined)) continue;
      const subject = input.storage.subjectFor(argument);
      const origins = subject.kind === "resolved" ? input.storage.originsFor(subject.subject) : undefined;
      if (origins?.kind !== "resolved") continue;
      for (const origin of origins.origins) {
        if (origin.subject.kind === "input" && origin.subject.projection.length === 0) nativeRetainedParameters.add(origin.subject.node);
      }
    }
  }
  const concreteParameters = new Set<Node>();
  for (const parameter of input.nativeNodes) {
    if (!input.ast.is.IsParameterDeclaration(parameter)) continue;
    const owner = input.ast.parent(parameter);
    if (owner === undefined || sourceCallableValueParameters(input.ast, owner,
      input.storage.source.semantics.forNode(owner))?.includes(parameter) !== true) continue;
    const abi = input.records.sourceParameterAbi.get(parameter);
    const borrowedCallable = abi !== undefined &&
      rustCallableInputProtocol(rustOptionElementCarrier(abi.parameterCarrier) ?? abi.parameterCarrier) !== undefined;
    if (!nativeRetainedParameters.has(parameter) && !borrowedCallable && input.ownedRetainedParameter(parameter))
      nativeRetainedParameters.add(parameter);
    if (!input.declaresGenericInputs(owner) || nativeRetainedParameters.has(parameter)) concreteParameters.add(parameter);
  }
  const keepsConcreteCarrier = (parameter: Node): boolean => nativeRetainedParameters.has(parameter);
  const bindings = new Map<Node, SourceStorageBindings | null>();
  const inputs = new Map<Node, Map<SourceStorageSubject, RustNativeCallableInput>>();
  const captures = new Map<Node, Set<RustNativeCallableInput>>();
  const values = new Map<Node, RustNativeCallableOrigins>();
  const concreteStorage = new Map<SourceStorageSubject, boolean>();
  const fields = new Set(input.projectTypes.definitions.flatMap(definition =>
    input.projectTypes.objectLayoutForDefinition(definition)?.fields.map(field => field.declaration) ?? []));
  let collecting = true;
  const bindingsFor = (declaration: Node): SourceStorageBindings | undefined => {
    const existing = bindings.get(declaration);
    if (existing !== undefined) return existing ?? undefined;
    const selected = input.storage.bindingsForLexicalOwner(declaration);
    const result = selected.kind === "resolved" ? selected.bindings : undefined;
    bindings.set(declaration, result ?? null);
    return result;
  };
  const selectConcreteStorage = (subject: SourceStorageSubject): boolean | undefined => {
    const existing = concreteStorage.get(subject);
    if (existing !== undefined) return existing;
    if (!collecting || input.storage.typeFor(subject).kind === "unresolved") return undefined;
    const component = subject.projection[subject.projection.length - 1];
    const declaration = subject.kind === "member" && subject.projection.length === 0 ? subject.node
      : component?.kind === "member" ? component.declaration : undefined;
    const declared = declaration === undefined || !fields.has(declaration) ? undefined
      : input.records.runtimeCarrier.get(declaration)?.carrier;
    if (declaration !== undefined && fields.has(declaration) && declared === undefined) return undefined;
    const selected = subject.kind === "input" && concreteParameters.has(subject.node) ||
      declared !== undefined && rustCallableProtocol(rustOptionElementCarrier(declared) ?? declared) !== undefined;
    concreteStorage.set(subject, selected);
    return selected;
  };
  const selectInput = (subject: SourceStorageSubject, carrier: TargetTypeRef): RustNativeCallableInput | undefined => {
    if (subject.kind !== "input") return undefined;
    const owner = input.ast.parent(subject.node);
    if (owner === undefined || sourceCallableValueParameters(input.ast, owner, input.storage.source.semantics.forNode(owner))?.includes(subject.node) !== true) return undefined;
    if (selectConcreteStorage(subject) !== false) return undefined;
    const selected = rustOptionElementCarrier(carrier) ?? carrier;
    if (rustGenericCallableProtocol(selected) === undefined && rustCallableProtocol(selected) === undefined) return undefined;
    const members = inputs.get(owner) ?? new Map<SourceStorageSubject, RustNativeCallableInput>();
    const existing = members.get(subject);
    if (existing !== undefined) {
      const contract = rustOptionElementCarrier(existing.carrier) ?? existing.carrier;
      return rustCallableInvocationSignaturesMatch(contract, selected) ? existing : undefined;
    }
    if (!collecting) return undefined;
    const identity = sourceNodeIdentity(input.ast, subject.node);
    const file = input.ast.getSourceFile(subject.node);
    if (identity === undefined || file === undefined) return undefined;
    const projection = subject.projection.map(component => component.kind === "array-element" ? "array"
      : component.kind === "tuple-element" ? `tuple:${component.index}`
      : sourceNodeIdentity(input.ast, component.declaration));
    if (projection.some(component => component === undefined)) return undefined;
    const nativeIdentity = `native-callable:${input.ast.getFileName(file)}:${identity}:${JSON.stringify(projection)}`;
    const component = componentByFile.get(input.ast.getFileName(file));
    const ownerFileName = component === undefined ? undefined : ownerByComponent.get(component);
    const protocol = ownerFileName === undefined ? undefined : registry.bind(ownerFileName, carrier);
    if (protocol === undefined) return undefined;
    const value: RustNativeCallableInput = Object.freeze({ owner, subject, carrier, ...protocol,
      implementation: Object.freeze({ kind: "type-parameter", name: `Implementation${members.size}`,
        identity: nativeIdentity }),
    });
    members.set(subject, value);
    inputs.set(owner, members);
    return value;
  };
  const originsFor = (declaration: Node, subject: SourceStorageSubject, carrier: TargetTypeRef): RustNativeCallableOrigins => {
    const selectedBindings = bindingsFor(declaration);
    if (selectedBindings === undefined) return { kind: "unresolved", reason: "Native callable storage requires an exact declaration-local input boundary." };
    const origins = input.storage.boundOriginsFor(subject, selectedBindings);
    if (origins.kind !== "resolved") return origins;
    const parameters = new Set<RustNativeCallableInput>();
    const implementations = new Set<SourceStorageSubject>();
    for (const origin of origins.subjects) {
      if (origin.kind === "return" && origin.projection.length === 0 &&
        isRustNeverCarrier(input.records.sourceCallableReturn.get(origin.node)?.returnCarrier)) continue;
      // A generic method read from an input is that input's stored generic callable family value, not a callable
      // input of this declaration.
      // A callable parameter of an owner emitted as a closure value keeps its concrete callable carrier; it is a concrete
      // value of this declaration, not a generic native input. A closure cannot be generic either.
      if (origin.kind !== "input") {
        implementations.add(origin);
        continue;
      }
      const concrete = selectConcreteStorage(origin);
      if (concrete === undefined) return { kind: "unresolved", reason: "Native callable storage requires its exact precomputed storage classification." };
      if (concrete || origin.projection[origin.projection.length - 1]?.kind === "method-value" &&
        rustGenericCallableValue(rustOptionElementCarrier(carrier) ?? carrier) !== undefined) {
        implementations.add(origin);
        continue;
      }
      const parameter = selectInput(origin, carrier);
      if (parameter === undefined) return { kind: "unresolved", reason: "Native callable input identity or selected carrier is inconsistent." };
      parameters.add(parameter);
      if (collecting && parameter.owner !== declaration) {
        const selected = captures.get(declaration) ?? new Set<RustNativeCallableInput>();
        selected.add(parameter);
        captures.set(declaration, selected);
      }
    }
    return Object.freeze({ kind: "resolved", inputs: Object.freeze([...parameters]),
      implementations: Object.freeze([...implementations]) });
  };
  const componentIssues: RustSourceCallableSpecializationIssue[] = [];
  const hasCallableData = (carrier: TargetTypeRef, active: Set<TargetTypeRef>, step: (depth: number) => boolean,
    depth: number): boolean | undefined => {
    if (!step(depth)) return undefined;
    const selected = rustOptionElementCarrier(carrier) ?? carrier;
    if (rustGenericCallableValue(selected) !== undefined || rustCallableProtocol(selected) !== undefined) return true;
    if (active.has(selected)) return false;
    active.add(selected);
    try {
      const structural = rustStructuralObjectCarrierValue(selected);
      const element = selected.kind === "array" || selected.kind === "slice" ? selected.element
        : rustJsArrayLikeElementTargetType(selected);
      const children = selected.kind === "tuple" ? selected.elements : element !== undefined ? [element]
        : structural?.fields.filter(field => field.method !== true && field.accessor === undefined && field.bound !== true)
          .map(field => field.type) ?? [];
      for (const child of children) {
        const required = hasCallableData(child, active, step, depth + 1);
        if (required !== false) return required;
      }
      return false;
    } finally {
      active.delete(selected);
    }
  };
  const collectInputComponents = (parameter: Node, carrier: TargetTypeRef,
    projection: SourceStorageSubject["projection"], active: Set<TargetTypeRef>, step: (depth: number) => boolean,
    depth = 0): string | undefined => {
    if (!step(depth)) return "Native callable input components exceed their bounded storage projection budget.";
    const required = hasCallableData(carrier, new Set(), step, depth);
    if (required === undefined) return "Native callable input components exceed their bounded storage projection budget.";
    if (!required) return;
    const selected = rustOptionElementCarrier(carrier) ?? carrier;
    if (active.has(selected)) return "Native callable input components require a finite complete storage path.";
    if (rustGenericCallableValue(selected) !== undefined || rustCallableProtocol(selected) !== undefined) {
      const subject = input.storage.subject(parameter, "input", projection);
      if (subject.kind === "unresolved") return subject.reason;
      const selectedInput = selectInput(subject.subject, carrier);
      const concrete = concreteStorage.get(subject.subject);
      if (concrete === undefined)
        return "Native callable input components require their exact checked storage classification.";
      if (!concrete && (selectedInput === undefined || selectedInput.subject !== subject.subject ||
        !rustTargetTypeRefEquals(selectedInput.carrier, carrier)))
        return "Native callable input components require their exact completed input protocol binding.";
      return;
    }
    active.add(selected);
    try {
      if (selected.kind === "tuple") {
        for (const [index, element] of selected.elements.entries()) {
          const failure = collectInputComponents(parameter, element, [...projection, { kind: "tuple-element", index }], active, step, depth + 1);
          if (failure !== undefined) return failure;
        }
        return;
      }
      const element = selected.kind === "array" || selected.kind === "slice" ? selected.element
        : rustJsArrayLikeElementTargetType(selected);
      if (element !== undefined)
        return collectInputComponents(parameter, element, [...projection, { kind: "array-element" }], active, step, depth + 1);
      const structural = rustStructuralObjectCarrierValue(selected);
      if (structural === undefined) return;
      const layout = input.structuralShapes.definitionForCarrier(selected);
      if (layout === undefined || layout.fields.length !== structural.fields.length)
        return "Native callable input components require their exact initialized structural layout.";
      const subject = input.storage.subject(parameter, "input", projection);
      if (subject.kind === "unresolved") return subject.reason;
      const checked = input.storage.typeFor(subject.subject);
      if (checked.kind === "unresolved") return checked.reason;
      const semantics = input.storage.source.semantics.forFile(checked.sourceFile);
      const present = semantics.types.nonNullableType(checked.type);
      if (present === undefined) return "Native callable input components require their exact checked present source type.";
      const properties = new Map(semantics.types.propertyInfos(present).map(property => [property.name, property]));
      for (const [index, field] of structural.fields.entries()) {
        if (field.method === true || field.accessor !== undefined || field.bound === true) continue;
        const required = hasCallableData(field.type, new Set(), step, depth + 1);
        if (required === undefined) return "Native callable input components exceed their bounded storage projection budget.";
        if (!required) continue;
        const physical = input.structuralShapes.field(selected, index);
        if (physical === undefined || physical.sourceName !== field.sourceName || physical.presence !== field.presence ||
          physical.readonly !== field.readonly || physical.method !== field.method)
          return "Native callable input components require exact instantiated structural field correspondence.";
        if (physical.storage !== "stored") continue;
        if (!rustTargetTypeRefEquals(physical.carrier, field.type))
          return "Native callable data components require their exact instantiated physical field carrier.";
        const property = properties.get(field.sourceName);
        const declarations = property === undefined ? [] : [...new Set([property.symbol, ...property.rootSymbols]
          .flatMap(symbol => semantics.declarations.symbolDeclarations(symbol)))];
        if (declarations.length === 0)
          return "Native callable input components require their original checked data-member declarations.";
        for (const declaration of declarations) {
          if (input.ast.is.IsMethodDeclaration(declaration) || input.ast.is.IsMethodSignatureDeclaration(declaration) ||
            input.ast.is.IsGetAccessorDeclaration(declaration) || input.ast.is.IsSetAccessorDeclaration(declaration))
            return "Native callable data components cannot replace a checked method or accessor owner.";
          const failure = collectInputComponents(parameter, field.type, [...projection, { kind: "member", declaration }], active, step, depth + 1);
          if (failure !== undefined) return failure;
        }
      }
    } finally {
      active.delete(selected);
    }
    return undefined;
  };
  for (const node of input.nativeNodes) {
    if (fields.has(node)) {
      const subject = input.storage.subject(node, "member");
      if (subject.kind === "resolved") selectConcreteStorage(subject.subject);
    }
    if (!input.ast.is.IsParameterDeclaration(node)) continue;
    const carrier = input.records.sourceParameterAbi.get(node)?.valueCarrier ??
      input.records.runtimeCarrier.get(node)?.carrier;
    if (carrier === undefined) continue;
    let remaining = rustNativeStorageProjectionSteps;
    const failure = collectInputComponents(node, carrier, [], new Set(),
      depth => remaining-- > 0 && depth <= rustNativeStorageProjectionDepth);
    if (failure !== undefined) componentIssues.push(Object.freeze({ subject: node, message: failure }));
  }
  for (const node of input.nativeNodes) {
    const carrier = input.records.runtimeCarrier.get(node)?.carrier;
    if (carrier === undefined) continue;
    const selected = rustOptionElementCarrier(carrier) ?? carrier;
    if (rustGenericCallableValue(selected) === undefined && rustCallableProtocol(selected) === undefined) continue;
    const owner = sourceEnclosingCallable(node, input.ast);
    if (owner === undefined) continue;
    const subject = input.storage.subjectFor(node);
    if (subject.kind === "resolved") values.set(node, originsFor(owner, subject.subject, carrier));
  }
  collecting = false;
  const selectedInputs = Object.freeze([...inputs.values()].flatMap(members => [...members.values()]));
  const definitions = registry.definitions();
  const protocols = new Map(definitions.map(protocol => [protocol.targetName, protocol]));
  const calls = new Map<Node, RustNativeCallableCall>();
  for (const node of input.storage.invocations) {
    const operation = input.records.targetOperation.get(node);
    if (operation?.kind !== "source-call" || operation.target.form !== "callable") continue;
    const callee = Node_Expression(input.ast, node);
    const origins = callee === undefined ? undefined : values.get(callee);
    if (origins?.kind !== "resolved" || origins.inputs.length !== 1 || origins.implementations.length !== 0) continue;
    const parameter = origins.inputs[0]!;
    const callIdentity = sourceNodeIdentity(input.ast, node);
    if (callIdentity === undefined) continue;
    const methodArguments = rustNativeCallableInvocationArguments(parameter, operation, callIdentity);
    if (methodArguments === undefined) continue;
    const completion = rustNativeCallableCompletion(operation.resultCarrier, input.definitions);
    if ((completion?.futures.length ?? 0) !== (parameter.protocol.completion?.futures.length ?? 0)) continue;
    const invocationError = rustNativeCallableErrorType(parameter, parameter.implementation, "invocation", methodArguments)!;
    const awaitErrors = (completion?.futures ?? []).map(future =>
      rustNativeCallableErrorType(parameter, parameter.implementation, future.ordinal, methodArguments)!);
    const source = `${parameter.implementation.identity}:${closedMetadataKey(methodArguments)}`;
    calls.set(node, Object.freeze({ node, input: parameter, invocationError,
      invocationErrorSource: `${source}:invocation`,
      ...(completion === undefined ? {} : { completion }), awaitErrors: Object.freeze(awaitErrors),
      awaitErrorSources: Object.freeze(awaitErrors.map((_error, index) =>
        rustJsPromiseOutputTargetType(completion!.futures[index]!.carrier) === undefined
          ? `${source}:await:${index}` : rustJsRejectionErrorIdentity)) }));
  }
  const declarationInputs = new Map([...inputs].map(([owner, members]) => [owner, Object.freeze([...members.values()])]));
  const declarationCaptures = new Map([...captures].map(([owner, members]) => [owner, Object.freeze([...members])]));
  const emptyInputs: readonly RustNativeCallableInput[] = Object.freeze([]);
  const isConcreteCallableParameter = (parameter: Node): boolean => concreteParameters.has(parameter);
  return Object.freeze({ bindingsFor, originsFor, isConcreteCallableParameter, issues: Object.freeze(componentIssues),
    isConcreteCallableStorage: (subject: SourceStorageSubject) => concreteStorage.get(subject),
    isNativeRetainedParameter: keepsConcreteCarrier, inputs: selectedInputs, protocols: definitions,
    calls: Object.freeze([...calls.values()]), callFor: (node: Node) => calls.get(node),
    inputsFor: (declaration: Node) => declarationInputs.get(declaration) ?? emptyInputs,
    capturesFor: (declaration: Node) => declarationCaptures.get(declaration) ?? emptyInputs,
    originsForValue: (node: Node) => values.get(node) ?? Object.freeze({ kind: "unresolved" as const,
      reason: "The value has no exact sealed declaration-local native callable origins." }),
    protocolForSourceItem: (fileName: string, typeName: string) => {
      const protocol = protocols.get(typeName);
      return protocol?.ownerFileName === fileName ? protocol : undefined;
    },
  });
}

export function analyzeRustNativeCallableGenerics(input: {
  readonly callableEntries: Pick<RustCallableEntryConstruction, "get">;
  readonly producer: RustNativeGenericProducer;
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "returnFor" | "valueFor">;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly nativeGenericProducers: RustNativeGenericProducerPlan;
  readonly retainedCallableInputs: RustRetainedCallableInputPlan;
  readonly declarationGenericRequirements: RustDeclarationGenericRequirementIndex;
}): TargetStageResult<void> {
  const contexts = new Map<Node, RustNativeCallableGenericContext>();
  const diagnostics: TargetDiagnostic[] = [];
  for (const { declaration } of input.nativeProducers.producers) {
    if (contexts.has(declaration)) continue;
    const header = input.callableEntries.get(declaration)?.genericHeader;
    if (header === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted native callable requires its completed early generic header.", declaration);
    const { sourceContract, implicitLifetimes, retention, callableInputs, inputs } = header;
    const sourceRequirements = input.declarationGenericRequirements.contractFor(declaration);
    const bodyRequirements = input.declarationGenericRequirements.contractFor(declaration, true);
    if (inputs.length === 0) {
      contexts.set(declaration, Object.freeze({ sourceContract, retention, implicitLifetimes, inputs: Object.freeze([]), sourceRequirements, bodyRequirements }));
      continue;
    }
    const bounds = new Map(inputs.map(selected => [selected.implementation.identity, new Map<string, TargetTypeRef>()]));
    for (const selected of callableInputs)
      bounds.get(selected.implementation.identity)!.set(closedMetadataKey(selected.trait), selected.trait);
    const visited = new Set<TargetTypeRef>();
    const collect = (carrier: TargetTypeRef): void => {
      if (visited.has(carrier)) return;
      visited.add(carrier);
      if (carrier.kind === "associated-type" && carrier.owner.kind === "type-parameter" && carrier.trait !== undefined)
        bounds.get(carrier.owner.identity)?.set(closedMetadataKey(carrier.trait), carrier.trait);
      for (const child of rustTargetTypeChildren(carrier)) collect(child);
    };
    if (input.records.sourceCallableReturn.get(declaration) !== undefined) {
      const selected = input.nativeStorage.returnFor(declaration);
      if (selected.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(declaration, selected.reason));
        continue;
      }
      collect(selected.carrier);
    }
    let failure: { readonly node: Node; readonly reason: string } | undefined;
    const caught = new Map<string, { readonly error: TargetTypeRef; readonly target: TargetTypeRef }>();
    const visit = (node: Node): void => {
      if (failure !== undefined || IsTypeSyntaxNode(input.ast, node)) return;
      for (const error of input.records.errorEffects.get(node)?.nativeErrors ?? []) collect(error.errorType);
      if (input.records.contextualValueConversion.get(node)?.conversion.kind === "callable-adapter") {
        const selected = input.nativeStorage.valueFor(node);
        if (selected.kind === "unresolved") { failure = { node, reason: selected.reason }; return; }
        collect(selected.carrier);
      }
      const call = input.native.callFor(node);
      if (call !== undefined) bounds.get(call.input.implementation.identity)?.set(closedMetadataKey(call.input.trait), call.input.trait);
      if (call !== undefined && rustNodeInCatchingTryBody(input.ast, node))
        caught.set(call.input.implementation.identity, Object.freeze({ error: call.invocationError, target: rustProgramErrorTargetType() }));
      input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(declaration);
    if (failure !== undefined) {
      diagnostics.push(emissionDiagnostic(failure.node, failure.reason));
      continue;
    }
    for (const forwarding of input.nativeGenericProducers.forwardingFor(declaration)) {
      const selected = bounds.get(forwarding.input.implementation.identity);
      if (selected === undefined) {
        failure = { node: declaration, reason: "A native callable forwarding requirement has no admitted original input." };
        break;
      }
      selected.set(closedMetadataKey(forwarding.trait), forwarding.trait);
    }
    const selectedInputs: RustNativeCallableGenericInput[] = [];
    for (const selected of inputs) {
      if (failure !== undefined) break;
      const callableInput = callableInputs.find(candidate => candidate === selected);
      const targets = callableInput === undefined ? [] : input.retainedCallableInputs.forInput(callableInput);
      const signature = targets.length === 0 || callableInput === undefined ? undefined
        : rustNativeCallableInputPhysicalSignature(callableInput, []);
      if (targets.length !== 0 && signature === undefined) {
        failure = { node: declaration, reason: "A retained native callable requires its exact physical invocation error." };
        break;
      }
      selectedInputs.push(Object.freeze({ implementation: selected.implementation,
        traits: Object.freeze([...bounds.get(selected.implementation.identity)!.values()]),
        retained: signature === undefined ? undefined : Object.freeze({ error: signature.error, targets }),
        caught: caught.get(selected.implementation.identity) }));
    }
    if (failure !== undefined) diagnostics.push(emissionDiagnostic(failure.node, failure.reason));
    else contexts.set(declaration, Object.freeze({ sourceContract, retention, implicitLifetimes, inputs: Object.freeze(selectedInputs),
      sourceRequirements, bodyRequirements }));
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  for (const [declaration, context] of contexts) input.producer.declaration(declaration, context);
  return resolvedTargetStage(undefined);
}
