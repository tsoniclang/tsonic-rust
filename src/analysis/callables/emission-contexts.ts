import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { targetUseSiteIdentity, targetUseSiteRef, type SourceStorageQueries, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustLifetimeKey, type RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustFinalizedOperationAbi, RustFinalizedValueConversion } from "../../target-model/records/finalized-operation.js";
import type { RustInitializationErrorRecords } from "../../target-model/records/error-regions.js";
import type { RustCallableEmissionContexts, RustEmissionErrorContext, RustEmissionReturnDestination,
  RustEmissionProviderOperation, RustPhysicalEmissionContext, RustPhysicalEmissionOperand, RustPhysicalEmissionOperandOrigin,
  RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins, RustPhysicalEmissionRole,
  RustEmissionCallableSpecialization } from "../../target-model/records/physical-emission-contexts.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { substituteRustTargetGenericArgument, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { closedMetadataEquals, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustProjectConstructionPlan } from "../project-types/construction-plan.js";
import { providerSourceInputKey } from "../operations/provider-source-inputs.js";
import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "./generic-bindings.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustFrameCallablePlan } from "./frame-values.js";
import type { RustSuspendedCallablePlan } from "./suspended-values.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustPhysicalCallableEmissionRequest, RustPhysicalCallableStorage } from "./physical-lifecycle.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustGenericCallableCompletionPlan } from "./generic-completions.js";
import type { RustGenericCallableErrorIndex } from "./generic-errors.js";
import type { RustNativeStorageConstruction, RustNativeStoragePlan } from "./native-storage.js";
import type { RustSourceCallableSpecializationPlan } from "./specializations.js";
import type { RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type { RustLexicalFunctionQueries } from "./lexical-functions.js";
import { rustCallableImplicitLifetimeParameters } from "./source-input-lifetimes.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { createRustEmissionSourceOriginPreparation, type RustEmissionSourceOwner,
  type RustEmissionSourceRequest } from "./emission-source-origins.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";
import type { RustSourceErrorRegionSelection } from "../../target-model/records/error-regions.js";
import type { RustGenericCallableInvocationFact } from "../../target-model/records/generic-callable-effects.js";
import type { RustNativeStorageSelection, RustCallablePhysicalAdapterPreparation } from "./native-storage.js";
import { prepareRustErrorRegion, type RustAnalyzedErrorRegions } from "../errors/regions.js";
import { substituteRustCallablePhysicalConversion } from "../../target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustCallablePhysicalAdapter } from "../../target-model/records/callable-adapters.js";
import type { RustHelperCallableEmissionRequest } from "./emission-adapters.js";


export interface RustCallableEmissionPreparationInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly sourceStorage: SourceStorageQueries;
  readonly genericBindingsFor: RustNativeStoragePlan["genericBindingsFor"];
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly generic: RustGenericCallablePlan;
  readonly frames: RustFrameCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustPhysicalCallableStorage;
  readonly prepareCallableAdapter: RustNativeStorageConstruction["prepareCallableAdapter"];
  readonly helperEmissionRequests: readonly RustHelperCallableEmissionRequest[];
  readonly declaredBindings: (declaration: Node) => RustTargetGenericBindings | undefined;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly genericCompletions: Pick<RustGenericCallableCompletionPlan, "forDefinition">;
  readonly genericErrors: RustGenericCallableErrorIndex<RustNativeErrorSource<TargetTypeRef>>;
  readonly declarationGenericRequirements: RustDeclarationGenericRequirementIndex;
  readonly errorRegions: Pick<RustAnalyzedErrorRegions, "get" | "sourceFor">;
  readonly initialization: RustInitializationErrorRecords<RustNativeErrorSource<TargetTypeRef>>;
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  readonly emissionRequests: readonly RustPhysicalCallableEmissionRequest[];
  readonly constructions: readonly RustProjectConstructionPlan[];
  readonly projectTypes: Pick<RustProjectTypePolicy, "openCarrier" | "relationship">;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlan;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly lexicalFunctions: RustLexicalFunctionQueries;
}

export interface RustCallableEmissionPreparation {
  readonly contexts: RustCallableEmissionContextPreparation;
  readonly physicalOperands: readonly TargetTypeRef[];
}

export interface RustPhysicalEmissionContextPreparation extends Omit<RustPhysicalEmissionContext, "targetGenericArguments" | "error" | "callableAdapters"> {
  readonly error: RustEmissionErrorContext<RustNativeErrorSource<TargetTypeRef>>;
  readonly nativeOwnerFileName: string;
  readonly callableAdapters: readonly RustCallablePhysicalAdapterPreparation[];
  readonly nativeOperations: ReadonlyMap<RustFinalizedOperationAbi, {
    readonly node: Node;
    readonly arguments: readonly RustTargetGenericArgument[];
  }>;
}

export interface RustPhysicalEmissionOperandPreparation extends Omit<RustPhysicalEmissionOperand,
  "context" | "sourceErrorRegions" | "genericInvocation"> {
  readonly context: RustPhysicalEmissionContextPreparation;
  readonly sourceErrorRegions: readonly { readonly edge: RustSourceErrorEffectEdge;
    readonly selection: RustSourceErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>> }[];
  readonly genericInvocation: RustGenericCallableInvocationFact | undefined;
}

export interface RustCallableEmissionContextPreparation extends
  Omit<RustCallableEmissionContexts, "contexts" | "operands" | "contextFor" | "contextForOwner" | "operandFor" |
    "bodyContextFor" | "sourceErrorOperandFor"> {
  readonly contexts: readonly RustPhysicalEmissionContextPreparation[];
  readonly operands: readonly RustPhysicalEmissionOperandPreparation[];
  contextFor(use: TargetUseSiteRef): RustPhysicalEmissionContextPreparation | undefined;
  contextForOwner(subject: object, role: RustPhysicalEmissionRole): RustPhysicalEmissionContextPreparation | undefined;
  operandFor(use: TargetUseSiteRef): RustPhysicalEmissionOperandPreparation | undefined;
  bodyContextFor(enclosingUse: TargetUseSiteRef, declaration: Node): RustPhysicalEmissionContextPreparation | undefined;
  sourceErrorOperandFor(context: TargetUseSiteRef, node: Node): RustPhysicalEmissionOperandPreparation | undefined;
}

export interface RustEmissionContextRequest extends RustEmissionSourceRequest {
  readonly callableAdapterInputs: readonly (Pick<RustCallablePhysicalAdapter, "node" | "selection"> & {
    readonly origin: Exclude<RustCallablePhysicalAdapter["origin"], { readonly kind: "expression" }>;
    readonly sourceBindings: RustTargetGenericBindings;
  })[];
  readonly nativeOwnerFileName: string;
  readonly role: RustPhysicalEmissionRole;
  readonly specialization: RustEmissionCallableSpecialization;
  readonly returnDestination: RustEmissionReturnDestination;
  readonly error: RustEmissionErrorContext<RustNativeErrorSource<TargetTypeRef>>;
  readonly sourceCarriers: readonly TargetTypeRef[];
  readonly physicalCarriers: readonly TargetTypeRef[];
}

export function rustPhysicalEmissionRecordCarriers(records: RustProgramRecords, node: Node): readonly TargetTypeRef[] {
  const read = records.flowReadProjection.get(node);
  const contextual = records.contextualValueConversion.get(node);
  const lifetime = records.callScopedLifetimeReconciliation.get(node);
  const upcast = records.projectUpcast.get(node);
  const downcast = records.projectDowncast.get(node);
  const view = records.objectReferenceView.get(node);
  const option = records.optionProjection.get(node);
  const abi = records.sourceParameterAbi.get(node);
  return [records.runtimeCarrier.get(node)?.carrier, records.conversion.get(node)?.convertedType,
    read?.sourceCarrier, read?.selectedCarrier, read !== undefined && "dispatchCarrier" in read ? read.dispatchCarrier : undefined,
    contextual?.sourceCarrier, contextual?.targetCarrier, lifetime?.sourceCarrier, lifetime?.selectedCarrier,
    upcast?.sourceCarrier, upcast?.targetCarrier, downcast?.sourceCarrier, downcast?.dispatchCarrier, downcast?.targetCarrier,
    view?.sourceCarrier, view?.targetCarrier, records.indexedFieldKeyArgument.get(node)?.carrier,
    option?.sourceCarrier, option !== undefined && option.kind === "some" ? option.elementCarrier : undefined, option?.resultCarrier,
    abi?.valueCarrier, abi?.parameterCarrier].filter((carrier): carrier is TargetTypeRef => carrier !== undefined);
}

export function rustEmissionIdentityBindings(arguments_: readonly RustTargetGenericArgument[]): RustTargetGenericBindings | undefined {
  const selected = rustGenericCallablePhysicalBindings(arguments_, arguments_);
  return selected === undefined ? undefined : snapshotRustCallableBindings(selected);
}

export function rustPhysicalEmissionOperationCarriers(abi: RustFinalizedOperationAbi): readonly TargetTypeRef[] {
  const converted = (conversion: RustFinalizedValueConversion): readonly TargetTypeRef[] => [conversion.sourceCarrier, conversion.targetCarrier,
    ...(conversion.kind === "sequence" ? conversion.steps.flatMap(step => [step.sourceCarrier, step.targetCarrier]) : [])];
  return [...(abi.sourceReceiver.kind === "receiver" ? [abi.sourceReceiver.carrier, abi.sourceReceiver.declaredCarrier] : []),
    ...abi.sourceArguments.map(argument => argument.carrier),
    ...abi.targetGenericArguments.flatMap(argument => argument.kind === "type" ? [argument.type] : []),
    ...(abi.result.kind === "sync" ? [abi.result.rawCarrier, abi.result.carrier, ...converted(abi.result.conversion)]
      : [abi.result.futureCarrier, abi.result.awaitedRawCarrier, abi.result.awaitedCarrier, ...converted(abi.result.awaitedConversion)]),
    ...(abi.effects.errorCarrier === undefined ? [] : [abi.effects.errorCarrier]), ...abi.effects.nativeErrorCarriers ?? []];
}

export function rustEmissionSourceIdentity(ast: AstReader, declaration: Node): string | undefined {
  const file = ast.getSourceFile(declaration);
  const identity = sourceNodeIdentity(ast, declaration);
  return file === undefined || identity === undefined ? undefined : `${ast.getFileName(file)}:${identity}`;
}

export function prepareRustCallableEmissionRequests(
  input: RustCallableEmissionPreparationInput,
): TargetStageResult<readonly RustEmissionContextRequest[]> {
  if (!Array.isArray(input.emissionRequests)) throw new Error("Physical emission requires its complete selecting-owner request vector.");
  if (!Array.isArray(input.helperEmissionRequests) || typeof input.declaredBindings !== "function")
    throw new Error("Physical emission requires its original pre-error-catalog helper requests and canonical binding inputs.");
  const requests: RustEmissionContextRequest[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  for (const issue of input.projectMethodDispatch.bodyIssues) if (input.isNativeNode(issue.node))
    diagnostics.push(emissionDiagnostic(issue.node, issue.reason));
  const byOwner = new Map<Node, RustPhysicalCallableEmissionRequest[]>();
  for (const demand of input.emissionRequests) {
    const demands = byOwner.get(demand.owner) ?? [];
    demands.push(demand);
    byOwner.set(demand.owner, demands);
  }
  const declaredBindings = input.declaredBindings;
  const suspendedParameters = new Map(input.suspended.implementations.map(implementation =>
    [implementation.declaration, implementation.parameters] as const));
  const bodyBindings = (declaration: Node, bindings: RustTargetGenericBindings): RustTargetGenericBindings | undefined => {
    const lexical = input.lexicalFunctions.forDeclaration(declaration);
    if (lexical?.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(declaration, lexical.reason));
      return undefined;
    }
    const captured = [...suspendedParameters.get(declaration) ?? (lexical?.genericParameters ?? []),
      ...rustCallableImplicitLifetimeParameters(declaration, input.ast, input.records)];
    const contract = input.sourceLifetimes.contractFor(declaration);
    const formal = contract?.parameters ?? [];
    const usedNames = new Set(formal.flatMap(parameter => parameter.kind === "lifetime" ? [parameter.lifetime.name] : []));
    const lifetimes = new Map(bindings.lifetimes);
    let changed = false;
    const select = (lifetime: import("../../target-model/lifetimes/model.js").RustLifetimeRef): void => {
      const key = rustLifetimeKey(lifetime);
      const existing = lifetimes.get(key);
      if (existing?.kind === lifetime.kind && "name" in existing && "name" in lifetime && existing.name === lifetime.name) return;
      lifetimes.set(key, lifetime);
      changed = true;
    };
    for (const parameter of formal) if (parameter.kind === "lifetime") select(parameter.lifetime);
    for (const parameter of captured) if (parameter.kind === "lifetime") select({
      ...parameter.lifetime, name: allocateRustGeneratedName(usedNames, parameter.lifetime.name),
    });
    return changed ? snapshotRustCallableBindings({ types: bindings.types, lifetimes, consts: bindings.consts }) : bindings;
  };
  const request = (subject: object, role: RustPhysicalEmissionRole, declaration: Node, identity: string, nativeOwnerFileName: string,
    bindings: RustTargetGenericBindings | undefined, demands: readonly RustPhysicalCallableEmissionRequest[], source: RustEmissionSourceOwner,
    sourceCarriers: readonly TargetTypeRef[],
    callableAdapterInputs: RustEmissionContextRequest["callableAdapterInputs"],
    physicalCarriers: readonly TargetTypeRef[] = [], physicalReturn: TargetTypeRef | undefined = undefined,
    specialization: RustEmissionCallableSpecialization = Object.freeze({ kind: "ordinary" })): void => {
    if (bindings !== undefined && (role === "native-body" || role === "specialized-body" || role === "project-body" || role === "body")) {
      const selected = bodyBindings(declaration, bindings);
      if (selected === undefined) return;
      bindings = selected;
    }
    if (bindings === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted native context has no exact canonical type, lifetime and const bindings."));
      return;
    }
    if (specialization.kind === "finite") {
      const parameters = input.sourceLifetimes.contractFor(declaration)?.parameters.filter(parameter => parameter.kind === "type") ?? [];
      if (parameters.length !== specialization.typeParameterIdentities.length ||
        parameters.some((parameter, index) => parameter.identity !== specialization.typeParameterIdentities[index]) ||
        new Set(specialization.typeParameterIdentities).size !== parameters.length ||
        specialization.typeParameterIdentities.some(identity => !bindings.types.has(identity))) {
        diagnostics.push(emissionDiagnostic(declaration, "A finite emitted body requires its exact original source-binder vector and selected replacements."));
        return;
      }
    }
    const returned = input.records.sourceCallableReturn.get(declaration);
    const generator = input.records.generator.get(declaration);
    const selected = returned === undefined || physicalReturn !== undefined || generator !== undefined
      ? undefined : input.nativeStorage.returnFor(declaration);
    if (selected?.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(declaration, selected.reason));
      return;
    }
    const region = input.errorRegions.get(declaration);
    if (region === undefined && input.records.errorEffects.get(declaration) !== undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted callable has no selected native error region."));
      return;
    }
    const returnDestination: RustEmissionReturnDestination = physicalReturn !== undefined
      ? Object.freeze({ kind: "value", carrier: physicalReturn, borrowedParameter: returned?.borrowedParameter })
      : generator !== undefined ? Object.freeze({ kind: "value", carrier: generator.returnType, borrowedParameter: undefined })
      : selected === undefined ? Object.freeze({ kind: "none" })
      : Object.freeze({ kind: "value", carrier: selected.carrier, borrowedParameter: returned?.borrowedParameter });
    const error: RustEmissionErrorContext<RustNativeErrorSource<TargetTypeRef>> = region === undefined ? Object.freeze({ kind: "none" })
      : Object.freeze({ kind: "region", owner: declaration, region });
    const requirements = input.declarationGenericRequirements.contractFor(declaration,
      role === "body" || role === "native-body" || role === "specialized-body" || role === "project-body" ? true : undefined);
    const required = requirements === undefined ? [] : [
      ...requirements.associatedTypes.flatMap(value => [value.carrier, ...value.output === undefined ? [] : [value.output]]),
      ...requirements.projectProjections.flatMap(value => [value.sourceCarrier, value.targetCarrier]),
      ...requirements.optionalStorage.map(value => value.carrier),
    ];
    requests.push({ use: targetUseSiteRef(subject, role, identity), role, specialization, declaration, nativeOwnerFileName, bindings, demands, source,
      callableAdapterInputs,
      returnDestination, error, sourceCarriers: [...sourceCarriers, ...required,
        ...generator === undefined ? [] : [generator.yieldType, generator.returnType, generator.nextType, generator.resultCarrier]], physicalCarriers });
  };
  for (const producer of input.nativeProducers.producers) {
    const implementation = input.generic.implementationFor(producer.declaration);
    const bindings = declaredBindings(producer.declaration);
    if (implementation?.creation === "activation") continue;
    request(producer.declaration, "native-body", producer.declaration, producer.identity, producer.fileName, bindings,
      byOwner.get(producer.declaration) ?? [], { kind: "declaration" },
      producer.environment.flatMap(argument => argument.kind === "type" ? [argument.type] : []), [],
      [input.nativeProducers.outwardReturnFor(producer.declaration), input.nativeProducers.invocationResultFor(producer.declaration),
        input.nativeProducers.bodyResultFor(producer.declaration)].filter((carrier): carrier is TargetTypeRef => carrier !== undefined));
    for (const variant of input.sourceCallableSpecializations.variantsForCallable(producer.declaration)) {
      if (bindings === undefined || variant.sourceTypeParameterIdentities.length !== variant.targetTypeArguments.length ||
        new Set(variant.sourceTypeParameterIdentities).size !== variant.sourceTypeParameterIdentities.length ||
        variant.sourceTypeParameterIdentities.some(identity => !bindings.types.has(identity))) {
        diagnostics.push(emissionDiagnostic(producer.declaration, "An emitted callable specialization requires every original declared binder exactly once."));
        continue;
      }
      const types = new Map(bindings.types);
      for (const [index, identity] of variant.sourceTypeParameterIdentities.entries()) types.set(identity, variant.targetTypeArguments[index]!);
      request(variant, "specialized-body", producer.declaration, `${producer.identity}:${variant.targetName}`,
        producer.fileName, snapshotRustCallableBindings({ types, lifetimes: bindings.lifetimes, consts: bindings.consts }),
        byOwner.get(producer.declaration) ?? [], { kind: "declaration" },
        producer.environment.flatMap(argument => argument.kind === "type" ? [argument.type] : []), [], [], undefined,
        Object.freeze({ kind: "finite", typeParameterIdentities: variant.sourceTypeParameterIdentities }));
    }
  }
  for (const body of input.projectMethodDispatch.bodies) {
    if (!input.isNativeNode(body.declaration)) continue;
    const lexical = declaredBindings(body.declaration);
    if (lexical === undefined) {
      diagnostics.push(emissionDiagnostic(body.declaration, "A concrete project body requires its original callable binding input."));
      continue;
    }
    const bindings = snapshotRustCallableBindings({
      types: new Map([...lexical.types, ...body.bindings.types]),
      lifetimes: new Map([...lexical.lifetimes, ...body.bindings.lifetimes]),
      consts: new Map([...lexical.consts, ...body.bindings.consts]),
    });
    const identity = rustEmissionSourceIdentity(input.ast, body.declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(body.declaration, "A concrete project body has no original source identity."));
      continue;
    }
    request(body, "project-body", body.declaration, `${body.concrete.targetPath}:${identity}:${body.targetName}`,
      body.concrete.fileName, bindings, byOwner.get(body.declaration) ?? [], { kind: "declaration" }, [body.ownerCarrier, ...body.targetTypeArguments], [], [], undefined,
      body.variant === undefined ? Object.freeze({ kind: "ordinary" })
        : Object.freeze({ kind: "finite", typeParameterIdentities: body.variant.sourceTypeParameterIdentities }));
  }
  for (const definition of input.generic.definitions) for (const implementation of definition.implementations) {
    const environment = input.generic.physical.environmentFor(implementation);
    if (environment === undefined) {
      diagnostics.push(emissionDiagnostic(implementation.declaration, "An emitted generic callable has no completed canonical physical environment."));
      continue;
    }
    const payloads = [...environment.captures.map(value => value.storageCarrier),
      ...environment.receiverFields.map(value => value.storageCarrier), ...environment.receivers.map(value => value.storageCarrier),
      ...environment.inputs.flatMap(value => [value.implementation, value.trait]),
      ...definition.signature.parameters, definition.signature.result];
    const identity = `${definition.identity}:${implementation.sourceFileName}:${sourceNodeIdentity(input.ast, implementation.declaration)}`;
    const source = { kind: "callable" as const, implementation: implementation.declaration, member: undefined };
    request(implementation, "helper", implementation.declaration, identity, definition.ownerFileName, environment.substitutions, [], source, payloads, []);
    if (implementation.creation === "activation") {
      request(implementation, "body", implementation.declaration, identity, definition.ownerFileName, environment.substitutions,
        byOwner.get(implementation.declaration) ?? [], source, payloads, []);
    }
  }
  for (const definition of input.generic.physical.definitions()) {
    const completion = input.genericCompletions.forDefinition(definition);
    const errors = input.genericErrors.forDefinition(definition);
    if (completion.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(definition.implementations[0]!.declaration, completion.reason));
      continue;
    }
    for (const member of definition.members) {
      const environment = input.generic.physical.environmentFor(member.implementation);
      const selectedCompletion = completion.kind === "direct" ? completion.result : completion.forMember(member)?.result;
      const selectedErrors = errors?.forMember(member);
      if (environment === undefined || selectedCompletion === undefined || selectedErrors === undefined) {
        diagnostics.push(emissionDiagnostic(member.implementation.declaration,
          "An emitted physical member has no selected environment or completion payload."));
        continue;
      }
      request(member, "member", member.implementation.declaration, definition.identity, definition.ownerFileName, member.bindings, [],
        { kind: "callable", implementation: member.implementation.declaration, member },
        [...environment.captures.map(value => value.storageCarrier), ...environment.receiverFields.map(value => value.storageCarrier),
          ...environment.receivers.map(value => value.storageCarrier), ...environment.inputs.flatMap(value => [value.implementation, value.trait]),
          ...definition.signature.parameters], [],
        [selectedCompletion, selectedErrors?.invocation?.errorType, selectedErrors?.awaiting?.errorType]
          .filter((carrier): carrier is TargetTypeRef => carrier !== undefined), selectedCompletion);
    }
  }
  for (const selected of input.native.inputs) {
    const identity = rustEmissionSourceIdentity(input.ast, selected.owner);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(selected.owner, "A native callable input has no canonical declaration identity."));
      continue;
    }
    request(selected, "native-input", selected.owner, identity, selected.protocol.ownerFileName, declaredBindings(selected.owner), [],
      { kind: "declaration" },
      [selected.carrier, selected.implementation, selected.trait, ...selected.environment,
        ...selected.protocol.method.parameters, selected.protocol.method.result], []);
  }
  for (const implementation of input.suspended.implementations) {
    const identity = rustEmissionSourceIdentity(input.ast, implementation.declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(implementation.declaration, "A suspended native implementation has no canonical declaration identity."));
      continue;
    }
    request(implementation, "native-backing", implementation.declaration, identity, implementation.sourceFileName,
      declaredBindings(implementation.declaration), [], { kind: "declaration" }, [implementation.carrier, ...implementation.storage], []);
  }
  for (const frame of input.frames.definitions) {
    const declaration = frame.activation.ownerDeclaration;
    const identity = rustEmissionSourceIdentity(input.ast, declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "A selected native frame has no canonical source owner identity."));
      continue;
    }
    const bindings = declaredBindings(declaration);
    request(frame, "frame", declaration, identity, frame.ownerFileName, bindings, [], { kind: "declaration" }, [...frame.bindings.map(value => value.carrier),
      ...frame.entries.flatMap(entry => [...entry.signature.parameters, entry.signature.result])], []);
  }
  for (const plan of input.constructions) {
    if (!input.isNativeNode(plan.definition.declaration) || input.ast.hasModifierKind(plan.definition.declaration, "abstract")) continue;
    for (const issue of plan.emission.issues) diagnostics.push(emissionDiagnostic(issue.node, issue.reason));
    const declaration = plan.definition.declaration;
    const identity = rustEmissionSourceIdentity(input.ast, declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "A selected constructor has no canonical declaration identity."));
      continue;
    }
    request(plan, "constructor", declaration, identity, plan.definition.fileName, declaredBindings(declaration),
      [], { kind: "construction", plan, layer: undefined }, plan.fields.map(field => field.carrier), []);
    const root = input.projectTypes.openCarrier(plan.definition);
    for (const layer of plan.layers) {
      const source = layer.constructor ?? layer.definition.declaration;
      const selected = input.projectTypes.relationship(root, layer.definition);
      const carrier = selected.kind === "related" ? rustSourceTypeCarrierValue(selected.targetType) : undefined;
      const parameters: RustTargetGenericArgument[] = layer.definition.genericParameters.map(parameter => parameter.kind === "lifetime"
        ? { kind: "lifetime", lifetime: parameter.lifetime }
        : { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } });
      const inherited = carrier === undefined ? undefined : rustGenericCallablePhysicalBindings(parameters, carrier.genericArguments);
      const lexical = declaredBindings(source);
      const bindings = inherited === undefined || lexical === undefined ? undefined : snapshotRustCallableBindings({
        types: new Map([...lexical.types, ...inherited.types]), lifetimes: new Map([...lexical.lifetimes, ...inherited.lifetimes]),
        consts: new Map([...lexical.consts, ...inherited.consts]) });
      const points = plan.points.filter(point => plan.emission.preparationFor(point.node)?.layer === layer);
      const demands = [...byOwner.get(layer.definition.declaration) ?? [],
        ...layer.constructor === undefined ? [] : byOwner.get(layer.constructor) ?? []];
      request(layer, "constructor-layer", source, identity, plan.definition.fileName, bindings, demands,
        { kind: "construction", plan, layer },
        layer.fields.map(field => field.carrier), [], points.flatMap(point =>
          plan.emission.preparationFor(point.node)?.projections.flatMap(projection => projection.kind === "receiver" ? [projection.carrier] : []) ?? []));
    }
  }
  for (const selected of input.helperEmissionRequests) {
    request(selected.subject, "helper", selected.declaration, selected.identity, selected.nativeOwnerFileName,
      selected.bindings, [], { kind: "declaration" }, selected.sourceCarriers, selected.callableAdapterInputs, [], selected.returnCarrier);
  }
  const coveredBodies = new Set(requests.flatMap(request => request.demands.map(demand => demand.owner)));
  for (const [owner, demands] of byOwner) {
    if (!input.records.sourceCallableReturn.get(owner) || input.ast.body(owner) === undefined || coveredBodies.has(owner)) continue;
    diagnostics.push(emissionDiagnostic(demands[0]!.subject,
      "An emitted callable demand requires its original selected body context before publication."));
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(requests)) : rejectedTargetStage(diagnostics);
}

export function prepareRustEmissionContextRequests(
  input: Pick<RustCallableEmissionPreparationInput, "ast" | "records" | "nativeStorage" | "sourceOccurrences" | "errorRegions" |
    "sourceStorage" | "genericBindingsFor" | "generic" | "emissionRequests" | "initialization" | "sourceLifetimes" | "prepareCallableAdapter">,
  selectedRequests: readonly RustEmissionContextRequest[],
): TargetStageResult<RustCallableEmissionPreparation> {
  const contexts: RustPhysicalEmissionContextPreparation[] = [];
  const operands: RustPhysicalEmissionOperandPreparation[] = [];
  const contextIndex = new Map<TargetUseSiteRef, RustPhysicalEmissionContextPreparation>();
  const ownerIndex = new Map<object, Map<RustPhysicalEmissionRole, RustPhysicalEmissionContextPreparation>>();
  const sourceOrigins = new Map<TargetUseSiteRef, ReadonlyMap<RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins>>();
  const operandIndex = new Map<object, Map<string, RustPhysicalEmissionOperandPreparation>>();
  const applications = new Map<TargetUseSiteRef, ReadonlyMap<TargetTypeRef, TargetTypeRef>>();
  const physicalOperands = new Set<TargetTypeRef>();
  const diagnostics: TargetDiagnostic[] = [];
  const requests = [...selectedRequests];
  const bodyUses = new Map<TargetUseSiteRef, Map<Node, TargetUseSiteRef>>();
  const sourceIndex = new Map<Node, Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>>();
  for (const occurrence of input.sourceOccurrences) {
    const selected = sourceIndex.get(occurrence.node) ?? new Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>();
    selected.set(occurrence.operation, occurrence);
    sourceIndex.set(occurrence.node, selected);
  }
  const requestedOwners = new Map<object, Set<RustPhysicalEmissionRole>>();
  for (const request of requests) {
    if (!Array.isArray(request.demands)) throw new Error("An emitted context requires its original selected demand rows, not a native-node inventory.");
    if (request.source === undefined) throw new Error("An emitted context requires its original selected source owner.");
    if (request.use.role !== request.role) throw new Error("An emitted context requires its exact finite selected role.");
    const roles = requestedOwners.get(request.use.subject) ?? new Set<RustPhysicalEmissionRole>();
    if (roles.has(request.role)) diagnostics.push(emissionDiagnostic(request.declaration,
      "One original emitted owner and role requires exactly one selected physical context."));
    roles.add(request.role);
    requestedOwners.set(request.use.subject, roles);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  const nativeBodies = new Map(requests.filter(request => request.role === "native-body")
    .map(request => [request.declaration, request] as const));
  const selectedDemands = new Set(input.emissionRequests);
  const creationOwners = new Map<TargetUseSiteRef, ReadonlySet<Node>>();
  for (let index = 0; index < requests.length; index += 1) {
    const enclosing = requests[index]!;
    const bodies = new Map<Node, TargetUseSiteRef>();
    if (enclosing.role === "native-body" && input.records.closureCapture.get(enclosing.declaration)?.invocationOwner === "shared-state")
      bodies.set(enclosing.declaration, enclosing.use);
    const ancestors = creationOwners.get(enclosing.use) ?? new Set([enclosing.declaration]);
    for (const demand of enclosing.demands) {
      if (demand.kind !== "type" || demand.context.role !== "inline-body") continue;
      const layer = enclosing.source.kind === "construction" ? enclosing.source.layer : undefined;
      const owns = layer === undefined ? demand.owner === enclosing.declaration
        : demand.owner === layer.definition.declaration || demand.owner === layer.constructor;
      if (!selectedDemands.has(demand) || !owns || demand.context.subject !== demand.subject) {
        diagnostics.push(emissionDiagnostic(demand.subject, "An inline body requires its exact original selecting creation owner and occurrence."));
        continue;
      }
      if (bodies.has(demand.subject)) continue;
      const original = nativeBodies.get(demand.subject);
      if (original === undefined || ancestors.has(demand.subject)) {
        diagnostics.push(emissionDiagnostic(demand.subject, "An inline body requires one complete acyclic original native body selection."));
        continue;
      }
      const parameters = input.sourceLifetimes.contractFor(demand.subject)?.parameters ?? [];
      const ownTypes = new Set(parameters.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : []));
      const ownLifetimes = new Set(parameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
      const types = new Map([...original.bindings.types].map(([identity, carrier]) => [identity, ownTypes.has(identity) ? carrier
        : substituteRustTargetGenerics(carrier, enclosing.bindings.types, enclosing.bindings.lifetimes, enclosing.bindings.consts)]));
      const lifetimes = new Map([...original.bindings.lifetimes].map(([identity, lifetime]) => [identity, ownLifetimes.has(identity) ? lifetime
        : enclosing.bindings.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime]));
      const consts = new Map(original.bindings.consts);
      for (const [identity, value] of consts) {
        const selected = substituteRustTargetGenericArgument({ kind: "const", value }, enclosing.bindings.types,
          enclosing.bindings.lifetimes, enclosing.bindings.consts);
        if (selected.kind !== "const") {
          diagnostics.push(emissionDiagnostic(demand.subject, "An inline native const argument lost its original argument kind."));
          continue;
        }
        consts.set(identity, selected.value);
      }
      const subject = Object.freeze({ declaration: demand.subject, enclosingUse: enclosing.use });
      const use = targetUseSiteRef(subject, "native-body", `${targetUseSiteIdentity(enclosing.use)}:${targetUseSiteIdentity(original.use)}`);
      const selected: RustEmissionContextRequest = { ...original, use,
        bindings: snapshotRustCallableBindings({ types, lifetimes, consts }),
        sourceCarriers: [...original.sourceCarriers, ...original.physicalCarriers], physicalCarriers: [] };
      requests.push(selected);
      bodies.set(demand.subject, use);
      creationOwners.set(use, new Set([...ancestors, demand.subject]));
    }
    bodyUses.set(enclosing.use, bodies);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  const prepareSourceOrigins = createRustEmissionSourceOriginPreparation({ ...input, physical: input.generic.physical }, requests);
  for (const request of requests) {
    const carriers = new Set<TargetTypeRef>();
    const applied = new Map<TargetTypeRef, TargetTypeRef>();
    const apply = (source: TargetTypeRef): TargetTypeRef => {
      const existing = applied.get(source);
      if (existing !== undefined) return existing;
      const selected = substituteRustTargetGenerics(source, request.bindings.types, request.bindings.lifetimes, request.bindings.consts);
      const result = selected === source ? source : snapshotClosedMetadata(selected);
      applied.set(source, result);
      applied.set(result, result);
      carriers.add(result);
      physicalOperands.add(result);
      return result;
    };
    for (const carrier of request.physicalCarriers) {
      applied.set(carrier, carrier);
      carriers.add(carrier);
      physicalOperands.add(carrier);
    }
    for (const carrier of request.sourceCarriers) apply(carrier);
    const returnDestination: RustEmissionReturnDestination = request.returnDestination.kind === "none" ? request.returnDestination
      : Object.freeze({ ...request.returnDestination, carrier: apply(request.returnDestination.carrier) });
    const contextCarriers: TargetTypeRef[] = [];
    const contextOrigins: RustPhysicalEmissionSourceOrigins[] = [];
    const contextAdapters: RustCallablePhysicalAdapterPreparation[] = [];
    const retainAdapter = (selected: RustCallablePhysicalAdapterPreparation): void => {
      const existing = contextAdapters.find(row => row.node === selected.node && row.selection === selected.selection);
      if (existing !== undefined && (existing.joinOwnerFileName !== selected.joinOwnerFileName ||
        !sameAdapterOrigin(existing.origin, selected.origin) || existing.sourceInput !== selected.sourceInput ||
        !rustTargetTypeRefEquals(existing.sourceCarrier, selected.sourceCarrier) || !closedMetadataEquals(existing.conversion, selected.conversion)))
        diagnostics.push(emissionDiagnostic(selected.node,
          "One physical helper boundary requires its exact original source slot and complete selected conversion."));
      else if (existing === undefined) contextAdapters.push(selected);
    };
    const nativeOperations = new Map<RustFinalizedOperationAbi, { readonly node: Node; readonly arguments: readonly RustTargetGenericArgument[] }>();
    const nativeOperation = (node: Node, abi: RustFinalizedOperationAbi): void => {
      if (nativeOperations.has(abi)) return;
      const arguments_ = abi.targetGenericArguments.map(argument => argument.kind === "type"
        ? Object.freeze({ kind: "type" as const, type: apply(argument.type) })
        : substituteRustTargetGenericArgument(argument, request.bindings.types, request.bindings.lifetimes, request.bindings.consts));
      nativeOperations.set(abi, Object.freeze({ node, arguments: Object.freeze(arguments_) }));
    };
    const error = request.error.kind === "region"
      ? Object.freeze({ ...request.error, region: prepareRustErrorRegion(request.error.region, apply) }) : request.error;
    const context: RustPhysicalEmissionContextPreparation = { use: request.use, role: request.role,
      specialization: request.specialization, declaration: request.declaration,
      nativeOwnerFileName: request.nativeOwnerFileName, nativeOperations,
      bindings: request.bindings, returnDestination, error, operands: contextCarriers, sourceOrigins: contextOrigins,
      callableAdapters: contextAdapters };
    for (const adapter of request.callableAdapterInputs) {
      const prepared = input.prepareCallableAdapter(adapter.node, adapter.selection, adapter.origin,
        adapter.sourceBindings, request.nativeOwnerFileName);
      if (prepared.kind === "rejected") { diagnostics.push(...prepared.diagnostics); continue; }
      retainAdapter(prepared.value);
      const retain = (selected: RustCallablePhysicalAdapterPreparation["conversion"]): void => {
        for (const carrier of [selected.carrier, ...selected.parameters, selected.result, selected.error,
          ...selected.source.parameters, selected.source.result, selected.source.error, ...selected.errors.map(source => source.errorType)]) {
          physicalOperands.add(carrier);
          carriers.add(carrier);
        }
        for (const part of [...selected.arguments, selected.resultPlan]) if (part.kind === "callable") retain(part.conversion);
      };
      retain(prepared.value.conversion);
      physicalOperands.add(prepared.value.sourceCarrier);
      carriers.add(prepared.value.sourceCarrier);
    }
    const add = (node: Node, origin: RustPhysicalEmissionOperandOrigin, source: TargetTypeRef,
      destination: TargetTypeRef | undefined, endpoints: readonly TargetTypeRef[],
      storage: Exclude<RustNativeStorageSelection, { readonly kind: "unresolved" }>, inputOrdinal?: number): void => {
      const sourceError = origin.kind === "operand" && origin.evaluation.kind === "ordinary" && origin.evaluation.site.role === "source-errors";
      const role = sourceError ? "source-error"
        : origin.kind === "call-input" ? `call-input:${providerSourceInputKey(origin.input)}:${inputOrdinal}`
        : origin.evaluation.kind === "ordinary" ? `${origin.kind}:${targetUseSiteIdentity(origin.evaluation.site)}` : origin.kind;
      const subject = sourceError ? node : origin.kind === "call-input" ? origin.input
        : origin.evaluation.kind === "provider-source" ? origin.evaluation.slot : origin.evaluation.site.subject;
      const use = targetUseSiteRef(subject, role,
        sourceError ? targetUseSiteIdentity(request.use) : request.use.enclosingContract, request.use.role);
      const values = new Map<TargetTypeRef, TargetTypeRef>();
      for (const endpoint of [source, ...endpoints, ...destination === undefined ? [] : [destination]]) {
        const carrier = apply(endpoint);
        values.set(endpoint, carrier);
        values.set(carrier, carrier);
      }
      const sourceErrorRegions: RustPhysicalEmissionOperandPreparation["sourceErrorRegions"][number][] = [];
      let genericInvocation: RustGenericCallableInvocationFact | undefined;
      for (const adapter of storage.callableAdapters) {
        if (adapter.node !== node) continue;
        retainAdapter(Object.freeze({ ...adapter, sourceCarrier: apply(adapter.sourceCarrier),
          conversion: substituteRustCallablePhysicalConversion(adapter.conversion, request.bindings, apply) }));
      }
      if (sourceError) {
        const edges = new Set([...(input.records.sourceErrorEffects.get(node)?.edges ?? []),
          ...(input.records.awaitSourceErrorEffects.get(node)?.branches.map(branch => branch.edge) ?? [])]);
        for (const edge of edges) {
          const selected = input.errorRegions.sourceFor(edge);
          if (selected === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted source call has no selected native error correspondence."));
          else sourceErrorRegions.push(Object.freeze({ edge,
            selection: Object.freeze({ ...selected, operand: prepareRustErrorRegion(selected.operand, apply) }) }));
        }
        const invocation = input.records.genericCallableInvocation.get(node);
        if (invocation !== undefined) genericInvocation = Object.freeze({ ...invocation, carrier: apply(invocation.carrier),
          invocation: Object.freeze(invocation.invocation.map(source => Object.freeze({ ...source, errorType: apply(source.errorType) }))),
          awaiting: Object.freeze(invocation.awaiting.map(source => Object.freeze({ ...source, errorType: apply(source.errorType) }))) });
      }
      const operand = Object.freeze({ use, node, context, origin, carrier: apply(source),
        destination: destination === undefined ? undefined : apply(destination), sourceErrorRegions: Object.freeze(sourceErrorRegions),
        genericInvocation });
      operands.push(operand);
      const indexed = operandIndex.get(use.subject) ?? new Map<string, RustPhysicalEmissionOperandPreparation>();
      indexed.set(targetUseSiteIdentity(use), operand);
      operandIndex.set(use.subject, indexed);
      applications.set(use, values);
    };
    const nodes = [...new Set(request.demands.map(demand => demand.subject))];
    const occurrences = nodes.flatMap(node => [...sourceIndex.get(node)?.values() ?? []]);
    const origins = new Map<RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins>();
    for (const occurrence of occurrences) {
      const selected = prepareSourceOrigins(request, occurrence);
      contextOrigins.push(selected);
      origins.set(occurrence, selected);
    }
    sourceOrigins.set(request.use, origins);
    const sourceSlots = new Set<object>(occurrences.flatMap(occurrence => occurrence.slots));
    for (const occurrence of occurrences) {
      for (const carrier of rustPhysicalEmissionOperationCarriers(occurrence.operation.abi)) apply(carrier);
      nativeOperation(occurrence.node, occurrence.operation.abi);
    }
    for (const node of nodes) {
      const resource = input.records.resourceManagement.get(node)?.disposal.target;
      if (resource?.form !== "provider") continue;
      for (const carrier of rustPhysicalEmissionOperationCarriers(resource.abi)) apply(carrier);
      nativeOperation(node, resource.abi);
    }
    for (const demand of request.demands) {
      if (demand.kind === "type") {
        apply(demand.carrier);
        continue;
      }
      if (demand.kind === "producer") continue;
      const node = demand.subject;
      const selected = demand.kind === "value" ? input.nativeStorage.valueFor(node)
        : demand.kind === "operand" ? input.nativeStorage.operandFor(node)
        : demand.kind === "return" ? input.nativeStorage.returnFor(node)
        : input.nativeStorage.invocationCallableFor(node);
      if (selected.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(node, selected.reason));
        continue;
      }
      if (demand.kind === "return" || demand.kind === "invocation") {
        apply(selected.carrier);
        continue;
      }
      if (sourceSlots.has(demand.context.subject)) continue;
      const endpoints = rustPhysicalEmissionRecordCarriers(input.records, node);
      const destination = input.records.contextualValueConversion.get(node)?.targetCarrier;
      const evaluation = Object.freeze({ kind: "ordinary" as const, site: demand.context });
      if (demand.kind === "operand" && demand.context.role === "source-errors") {
        const value = input.nativeStorage.valueFor(node);
        if (value.kind === "unresolved") diagnostics.push(emissionDiagnostic(node, value.reason));
        else add(node, Object.freeze({ kind: "operand", evaluation }), selected.carrier, destination, endpoints, value);
      } else add(node, Object.freeze({ kind: demand.kind, evaluation }), selected.carrier, destination, endpoints, selected);
    }
    for (const occurrence of occurrences) for (const slot of occurrence.slots) {
      const value = input.nativeStorage.valueFor(slot.node);
      const operand = input.nativeStorage.operandFor(slot.node);
      if (value.kind === "unresolved" || operand.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(slot.node, value.kind === "unresolved" ? value.reason
          : operand.kind === "unresolved" ? operand.reason : "Missing prepared provider source storage."));
        continue;
      }
      const evaluation = Object.freeze({ kind: "provider-source" as const, slot });
      const endpoints = [slot.source.row.carrier, ...rustPhysicalEmissionRecordCarriers(input.records, slot.node)];
      const destination = input.records.contextualValueConversion.get(slot.node)?.targetCarrier;
      add(slot.node, Object.freeze({ kind: "value", evaluation }), value.carrier, destination, endpoints, value);
      add(slot.node, Object.freeze({ kind: "operand", evaluation }), operand.carrier, destination, endpoints, operand);
    }
    for (const occurrence of occurrences) for (const [ordinal, { input: value, slot }] of occurrence.inputs.entries()) {
      const source = input.nativeStorage.operandFor(slot.node);
      if (source.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(slot.node, source.reason));
        continue;
      }
      add(slot.node, Object.freeze({ kind: "call-input", operationNode: occurrence.node, operation: occurrence.operation, input: value }),
        source.carrier, value.parameterCarrier, [value.sourceCarrier, value.conversion.sourceCarrier, value.conversion.targetCarrier,
          ...(value.conversion.kind === "sequence" ? value.conversion.steps.flatMap(step => [step.sourceCarrier, step.targetCarrier]) : []),
          ...rustPhysicalEmissionRecordCarriers(input.records, slot.node)], source, ordinal);
    }
    if (request.error.kind === "region") {
      for (const source of request.error.region.sources) apply(source.errorType);
      for (const carrier of request.error.region.jsRejection?.requiredCarriers ?? []) apply(carrier);
    }
    contextCarriers.push(...carriers);
    Object.freeze(contextCarriers);
    Object.freeze(contextOrigins);
    Object.freeze(contextAdapters);
    Object.freeze(nativeOperations);
    Object.freeze(context);
    contexts.push(context);
    contextIndex.set(request.use, context);
    const owner = ownerIndex.get(request.use.subject) ?? new Map<RustPhysicalEmissionRole, RustPhysicalEmissionContextPreparation>();
    owner.set(request.role, context);
    ownerIndex.set(request.use.subject, owner);
    applications.set(request.use, applied);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  return resolvedTargetStage(Object.freeze({ physicalOperands: Object.freeze([...physicalOperands]),
    contexts: Object.freeze({ contexts: Object.freeze(contexts), operands: Object.freeze(operands), sourceOccurrences: input.sourceOccurrences,
      contextFor: (use: TargetUseSiteRef) => contextIndex.get(use),
      contextForOwner: (subject: object, role: RustPhysicalEmissionRole) => ownerIndex.get(subject)?.get(role),
      bodyContextFor: (enclosingUse: TargetUseSiteRef, declaration: Node) => {
        const use = bodyUses.get(enclosingUse)?.get(declaration);
        return use === undefined ? undefined : contextIndex.get(use);
      },
      operandFor: (use: TargetUseSiteRef) => applications.has(use) ? operandIndex.get(use.subject)?.get(targetUseSiteIdentity(use)) : undefined,
      sourceErrorOperandFor: (context: TargetUseSiteRef, node: Node) => contextIndex.has(context)
        ? operandIndex.get(node)?.get(targetUseSiteIdentity(
          { role: "source-error", enclosingContract: targetUseSiteIdentity(context), specialization: context.role })) : undefined,
      carrierFor: (use: TargetUseSiteRef, source: TargetTypeRef) => applications.get(use)?.get(source),
      sourceOriginFor: (use: TargetUseSiteRef, occurrence: RustPhysicalEmissionSourceOccurrence) => sourceOrigins.get(use)?.get(occurrence),
      sourceFor: (node: Node, operation: RustEmissionProviderOperation) => sourceIndex.get(node)?.get(operation) }) }));
}

export function emissionDiagnostic(node: Node, message: string): TargetDiagnostic {
  return { code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
    sourceNode: node, message, evidence: ["rust.callable-value.physical-emission-context"] };
}

function sameAdapterOrigin(left: RustCallablePhysicalAdapter["origin"], right: RustCallablePhysicalAdapter["origin"]): boolean {
  switch (left.kind) {
    case "expression": return right.kind === "expression" && left.subject === right.subject;
    case "parameter": return right.kind === "parameter" && left.abi === right.abi;
    case "return": return right.kind === "return" && left.declaration === right.declaration;
    case "field": return right.kind === "field" && left.selection === right.selection;
  }
}
