import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import { isSourceCallableBodyBoundary, TryStatement_CatchClause,
  TryStatement_TryBlock } from "@tsonic/target-api/source";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustErrorJoinDeclaration, RustErrorRegionRecords, RustErrorRegionSelection,
  RustInitializationErrorRecords, RustSourceErrorRegionSelection, RustInitializerSelection,
  RustLifecycleErrorSelection, RustPhysicalErrorOwner } from "../../target-model/records/error-regions.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustCallableConversion } from "../../target-model/conversions/callable.js";
import { rustCallableConversionErrorArities } from "../../policy/conversions/callable-physical.js";
import type { RustCallableValueAdapter } from "../../target-model/records/callable-adapters.js";
import type { RustNativeCallableProducer } from "../../target-model/records/native-producers.js";
import type { RustCallableValuePlan } from "../callables/values/value-plan.js";
import type { RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { rustProducerErrorReference, rustProducerErrorTargetType } from "../../target-model/types/carriers/producer-errors.js";
import { bindRustGenericArguments } from "../../target-model/types/carriers/generic-argument-bindings.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustNativeCallableCompletion } from "../../policy/types/callables/native-completion.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { normalizeRustErrorType, selectRustPhysicalProgramErrorOwner, type RustErrorTypeContext } from "./error-types.js";
import { rustNativeErrorJoinReference, rustNativeErrorJoinTargetType, type RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import { closedMetadataKey, isClosedMetadata, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { snapshotRustNativeErrorSources } from "../../target-model/types/native-error-joins.js";
import { selectRustJsRejectionRegion } from "../../policy/operations/flow/js-rejection.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustJsValueTargetType, rustProgramErrorTargetType } from "../../target-model/types/carriers/js.js";
import type { RustPromiseBodies } from "../../target-model/records/callables-and-resources.js";
import type { RustNativeTaskCompletion } from "../callables/native/native-tasks.js";
import { mapRustAwaitSelection, type RustAwaitSelection } from "../../target-model/types/await.js";
import type { RustAwaitValueLeafFact } from "../../target-model/records/await-values.js";
import type { RustBinaryHookPlan } from "../project/index.js";
import { rustRuntimeErrorTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/error-effects.js";
import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition, RustFrameCallableImplementation,
  RustFrameEntryErrorSelection, RustFrameImplementationErrorSelection } from "../../target-model/records/frame-callables.js";
import { mergeRustErrorEffects, rustProducerInvocationErrorEffects } from "./error-effects.js";
import { rustUninhabitedError } from "../../policy/conversions/callable-physical.js";
import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustFrameCallableEnvironmentBindings } from "../callables/values/frame-values.js";

export interface RustAnalyzedErrorRegions extends Pick<RustErrorRegionRecords, "get" | "sourceFor" | "producerError"> {
  lifecycleFor(initializers: readonly RustInitializerSelection[], owner: RustPhysicalErrorOwner): TargetStageResult<RustLifecycleErrorSelection>;
  taskCompletionFor(node: Node): RustAwaitSelection<RustAwaitValueLeafFact> | undefined;
  complete(initialization: RustInitializationErrorRecords): RustErrorRegionRecords;
}

export function rustErrorRegionCarrier(selected: RustErrorRegionSelection): TargetTypeRef | undefined {
  return selected.jsRejection === undefined ? rustNativeErrorJoinTargetType(selected.fileName,
    [...(selected.localOwner === undefined ? [] : [rustProgramErrorTargetType(selected.localOwner)]),
      ...selected.sources.map(source => source.errorType)]) : rustJsValueTargetType();
}

export function selectRustErrorRegion(
  node: Node,
  effects: RustErrorEffectsFact,
  input: RustErrorTypeContext & {
    readonly records: Pick<RustProgramRecords, "targetOperation">;
    readonly promiseBodies: Pick<RustPromiseBodies, "objects">;
  },
  body: boolean,
): TargetStageResult<RustErrorRegionSelection> {
  const reject = (message: string): TargetStageResult<RustErrorRegionSelection> => rejectedTargetStage([{
    code: "RUST_ERROR_REGION_UNRESOLVED", category: "error", source: "tsonic-rust", sourceNode: node,
    message, evidence: ["target.capability=rust.analysis.error-regions"],
  }]);
  const file = input.ast.getSourceFile(node);
  const owner = effects.localErrors ? selectRustPhysicalProgramErrorOwner(node, input) : undefined;
  const sources: RustNativeErrorSource<TargetTypeRef>[] = [];
  for (const source of effects.nativeErrors) {
    const errorType = normalizeRustErrorType(source.errorType, input, node);
    if (errorType === undefined) return reject("An error region has no exact normalized native payload carrier.");
    if (!rustUninhabitedError(errorType)) sources.push(Object.freeze({ identity: source.identity,
      variant: `Error${sources.length + (effects.localErrors ? 1 : 0)}`, errorType }));
  }
  if (file === undefined || effects.localErrors && owner === undefined)
    return reject("An error region has no exact physical package owner or native payload carrier.");
  const selectedSources = snapshotRustNativeErrorSources(sources, isRustTargetTypeRef);
  if (selectedSources === undefined || selectedSources.length + (owner === undefined ? 0 : 1) > 4096)
    return reject("An error region exceeds its bounded exact native error-source contract.");
  const closure = body ? input.records.targetOperation.get(node) : undefined;
  const callback = closure?.kind === "closure" ? rustCallableProtocol(closure.resultCarrier) : undefined;
  const promiseBody = body && (input.promiseBodies.objects.has(node) ||
    rustTargetTypeRefEquals(callback?.error, rustJsValueTargetType()));
  const jsRejection = promiseBody ? selectRustJsRejectionRegion(owner, selectedSources) : undefined;
  if (promiseBody && jsRejection === undefined)
    return reject("A JS Promise rejection region has no bounded exact native conversion selection.");
  return resolvedTargetStage(Object.freeze({
    kind: effects.nativeErrors.length > 0 ? "native" : effects.localErrors ? "package" : "infallible",
    fileName: input.ast.getFileName(file), localOwner: owner, sources: selectedSources,
    ...(jsRejection === undefined ? {} : { jsRejection }),
  }));
}

export function selectRustFrameEntryErrors(
  definition: RustFrameCallableDefinition,
  entry: RustFrameCallableEntryDefinition,
  input: RustErrorTypeContext & {
    readonly records: Pick<RustProgramRecords, "targetOperation">;
    readonly promiseBodies: Pick<RustPromiseBodies, "objects" | "declarations">;
  },
  effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined,
): TargetStageResult<RustFrameEntryErrorSelection> {
  const operands = new Map<RustFrameCallableImplementation, RustErrorRegionSelection>();
  const effects: RustErrorEffectsFact[] = [];
  for (const implementation of entry.implementations) {
    const selected = effectsFor(implementation.declaration);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A native frame entry requires completed intrinsic effects for every original implementation.", implementation.declaration);
    const invocation = rustProducerInvocationErrorEffects(implementation.declaration, input);
    if (invocation === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A native frame implementation requires its original selected producer invocation channel.", implementation.declaration);
    const region = selectRustErrorRegion(implementation.declaration, invocation, input, false);
    if (region.kind === "rejected") return region;
    const operand = region.value;
    operands.set(implementation, operand);
    effects.push({ localErrors: operand.localOwner !== undefined,
      nativeErrors: operand.sources.map(source => ({ identity: source.identity, errorType: source.errorType })) });
  }
  const merged = mergeRustErrorEffects(effects);
  if (merged === undefined) return rejectedTargetStage([{
    code: "RUST_ERROR_EFFECT_CONFLICT", category: "error", source: "tsonic-rust",
    sourceNode: definition.activation.ownerDeclaration,
    message: "One native frame entry has inconsistent exact implementation error channels.",
    evidence: ["target.capability=rust.native-error.exact-effects"],
  }]);
  const region = selectRustErrorRegion(definition.activation.ownerDeclaration, merged, input, false);
  if (region.kind === "rejected") return region;
  const carrierFor = (selected: RustErrorRegionSelection): TargetTypeRef => {
    const carrier = rustErrorRegionCarrier(selected);
    if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A completed native frame error region requires its exact closed native carrier.", definition.activation.ownerDeclaration);
    return carrier;
  };
  const carrier = carrierFor(region.value);
  const implementations = new Map<RustFrameCallableImplementation, RustFrameImplementationErrorSelection>();
  for (const [implementation, operand] of operands) {
    const source = carrierFor(operand);
    if (rustUninhabitedError(source)) implementations.set(implementation, Object.freeze({ kind: "infallible" }));
    else if (rustTargetTypeRefEquals(source, carrier)) implementations.set(implementation, Object.freeze({ kind: "identity" }));
    else implementations.set(implementation, Object.freeze({ kind: "mapped", transport: Object.freeze({ operand,
      local: operand.localOwner === undefined ? undefined : Object.freeze({ kind: "local" as const }),
      channels: Object.freeze(operand.sources.map(selected => Object.freeze({
        sourceIdentity: selected.identity, targetIdentity: selected.identity, uninhabited: rustUninhabitedError(selected.errorType),
      }))),
    }) }));
  }
  return resolvedTargetStage(Object.freeze({ carrier, region: region.value, implementations }));
}

export function rustFrameInvocationErrorOperand(
  carrier: TargetTypeRef,
  frames: RustFrameCallablePlan,
): RustErrorRegionSelection | undefined {
  const frame = rustFrameCallableValue(carrier);
  const entry = frame === undefined ? undefined : frames.entryFor(carrier);
  const definition = frame === undefined ? undefined : frames.definitionFor(carrier);
  const substitutions = frame === undefined || entry === undefined || definition === undefined ? undefined
    : rustFrameCallableEnvironmentBindings(definition, entry, frame.environment);
  if (entry === undefined || substitutions === undefined) return undefined;
  const selected = frames.entryErrors(entry);
  const sources = selected.region.sources.map(source => ({ ...source,
    errorType: substituteRustTargetGenerics(source.errorType, substitutions, new Map()) }));
  return Object.freeze({ ...selected.region, sources: Object.freeze(sources) });
}

export function selectRustFrameInvocationErrors(
  carrier: TargetTypeRef,
  frames: RustFrameCallablePlan,
  effects: RustErrorEffectsFact,
  edges: readonly RustSourceErrorEffectEdge[],
  regions: Pick<RustErrorRegionRecords, "sourceFor">,
): RustSourceErrorRegionSelection | undefined {
  const operand = rustFrameInvocationErrorOperand(carrier, frames);
  if (operand === undefined) return undefined;
  const selections = edges.map(edge => regions.sourceFor(edge));
  if (selections.some(selection => selection === undefined)) return undefined;
  const channels: RustSourceErrorRegionSelection["channels"][number][] = [];
  for (const source of operand.sources) {
    const targets = new Set<string>();
    for (const selection of selections) {
      const original = selection!.operand.sources.find(candidate => candidate.identity === source.identity &&
        rustTargetTypeRefEquals(candidate.errorType, source.errorType));
      if (original === undefined) continue;
      const channel = selection!.channels.find(candidate => candidate.sourceIdentity === original.identity);
      if (channel !== undefined) targets.add(channel.targetIdentity);
    }
    if (targets.size === 0 && effects.nativeErrors.some(candidate => candidate.identity === source.identity &&
      rustTargetTypeRefEquals(candidate.errorType, source.errorType))) targets.add(source.identity);
    if (targets.size !== 1) return undefined;
    channels.push(Object.freeze({ sourceIdentity: source.identity, targetIdentity: [...targets][0]!,
      uninhabited: rustUninhabitedError(source.errorType) }));
  }
  const locals = selections.filter(selection => selection!.operand.localOwner !== undefined).map(selection => selection!.local);
  if (operand.localOwner !== undefined && (locals.length === 0 || locals.some(local => local === undefined ||
    closedMetadataKey(local) !== closedMetadataKey(locals[0])))) return undefined;
  return Object.freeze({ operand, local: operand.localOwner === undefined ? undefined : locals[0],
    channels: Object.freeze(channels) });
}

export function analyzeRustErrorRegions(input: RustErrorTypeContext & {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly callables: Pick<RustCallableValuePlan, "native" | "nativeGenericProducers" | "frames">;
  readonly promiseBodies: RustPromiseBodies;
  readonly nativeTasks: readonly RustNativeTaskCompletion[];
  readonly binaryHooks: readonly RustBinaryHookPlan[];
}): TargetStageResult<RustAnalyzedErrorRegions> {
  const regions = new Map<Node, RustErrorRegionSelection>();
  const localSites = new Map<Node, Node[]>();
  const sourceRegions = new Map<RustSourceErrorEffectEdge, RustSourceErrorRegionSelection>();
  const declarations = new Map<string, readonly RustErrorJoinDeclaration[]>();
  const demandedArities = new Map<string, Set<number>>();
  const runtimeErrorArms = new Map<string, Map<number, number>>();
  const producers = new Map<string, {
    readonly producer: RustNativeCallableProducer;
    readonly channels: ReadonlyMap<RustProducerErrorReference["channel"], TargetTypeRef>;
  }>();
  const diagnostics: TargetDiagnostic[] = [];
  const taskEdges = new Set(input.nativeTasks.flatMap(spawn => input.records.sourceErrorEffects.get(spawn.node)?.edges ?? []));
  const taskCompletions = new Map<Node, RustAwaitSelection<RustAwaitValueLeafFact>>();
  let lifecycle: RustLifecycleErrorSelection | undefined;
  let lifecycleSelected = false;
  let closed = false;
  const reject = (node: Node, message: string): void => {
    diagnostics.push({ code: "RUST_ERROR_REGION_UNRESOLVED", category: "error", source: "tsonic-rust",
      sourceNode: node, message, evidence: ["target.capability=rust.analysis.error-regions"] });
  };
  const registerRuntimeArm = (fileName: string, arity: number, arm: number, node: Node): void => {
    if (arity < 2) return;
    const entries = runtimeErrorArms.get(fileName) ?? new Map<number, number>();
    const previous = entries.get(arity);
    if (previous !== undefined && previous !== arm) {
      reject(node, "One native error-join declaration requires a consistent proved runtime-intrinsic injection arm.");
      return;
    }
    entries.set(arity, arm);
    runtimeErrorArms.set(fileName, entries);
  };
  const inspectedCarriers = new Set<TargetTypeRef>();
  const inspectCarrier = (carrier: TargetTypeRef): void => {
    if (inspectedCarriers.has(carrier)) return;
    inspectedCarriers.add(carrier);
    const join = rustNativeErrorJoinReference(carrier);
    if (join !== undefined) {
      const arities = demandedArities.get(join.fileName) ?? new Set<number>();
      arities.add(join.errors.length);
      demandedArities.set(join.fileName, arities);
    }
    rustTargetTypeChildren(carrier).forEach(inspectCarrier);
  };
  const regionFor = (node: Node, effects: RustErrorEffectsFact, body = false): RustErrorRegionSelection | undefined => {
    const selection = selectRustErrorRegion(node, effects, input, body);
    if (selection.kind === "rejected") {
      diagnostics.push(...selection.diagnostics);
      return undefined;
    }
    selection.value.sources.forEach(source => inspectCarrier(source.errorType));
    return selection.value;
  };
  const sourceRegionFor = (node: Node, edge: RustSourceErrorEffectEdge): RustSourceErrorRegionSelection | undefined => {
    const source = input.records.errorEffects.get(edge.declaration);
    if (source === undefined || source.localErrors !== edge.effects.localErrors ||
      source.nativeErrors.length !== edge.nativeErrors.length) {
      reject(node, "A source invocation has no exact declaration-to-caller error correspondence.");
      return;
    }
    const channels = new Map(edge.nativeErrors.map(channel => [channel.source.identity, channel]));
    const instantiated = source.nativeErrors.map(selected => {
      const channel = channels.get(selected.identity);
      return channel === undefined || !rustTargetTypeRefEquals(selected.errorType, channel.source.errorType) ||
        !edge.effects.nativeErrors.some(target => target.identity === channel.target.identity &&
          rustTargetTypeRefEquals(target.errorType, channel.target.errorType))
        ? undefined : Object.freeze({ identity: selected.identity, errorType: channel.target.errorType });
    });
    if (channels.size !== edge.nativeErrors.length || instantiated.some(channel => channel === undefined) ||
      edge.effects.nativeErrors.some(target => !edge.nativeErrors.some(channel => channel.target.identity === target.identity))) {
      reject(node, "A source invocation has inconsistent exact native error channels.");
      return;
    }
    const declaration = regionFor(edge.declaration, source);
    if (declaration === undefined) return;
    const sources: RustNativeErrorSource<TargetTypeRef>[] = [];
    for (const selected of declaration.sources) {
      const bound = channels.get(selected.identity);
      const errorType = bound === undefined ? undefined : normalizeRustErrorType(bound.target.errorType, input, edge.declaration);
      if (errorType === undefined) {
        reject(node, "A source invocation requires its identical declared native error arm and closed actual carrier.");
        return;
      }
      inspectCarrier(errorType);
      sources.push(Object.freeze({ ...selected, errorType }));
    }
    const operand = Object.freeze({ ...declaration, sources: Object.freeze(sources) });
    return Object.freeze({ operand,
      local: operand.localOwner === undefined ? undefined : Object.freeze({ kind: "local" as const }),
      channels: Object.freeze(operand.sources.map(selected =>
      Object.freeze({ sourceIdentity: selected.identity, targetIdentity: channels.get(selected.identity)!.target.identity,
        uninhabited: isRustNeverCarrier(selected.errorType) || selected.errorType.kind === "target-named" &&
          selected.errorType.id === rustInfallibleTargetId }))) });
  };
  for (const producer of input.producers.producers) {
    const asynchronous = input.records.asyncFunction.get(producer.declaration);
    const result = asynchronous?.futureCarrier ?? input.records.sourceCallableReturn.get(producer.declaration)?.returnCarrier;
    const completion = result === undefined ? undefined : rustNativeCallableCompletion(result, input.definitions);
    const channels = new Map<RustProducerErrorReference["channel"], TargetTypeRef>();
    const suspended = asynchronous !== undefined || input.records.generator.get(producer.declaration) !== undefined;
    const body: readonly RustProducerErrorReference["channel"][] = suspended ? ["body"] : [];
    for (const channel of ["invoke" as const, ...body, ...Array.from({ length: completion?.futures.length ?? 0 }, (_value, index) => index)]) {
      const carrier = normalizeRustErrorType(rustProducerErrorTargetType({ identity: producer.identity,
        fileName: producer.fileName, channel, genericArguments: producer.environment }), input);
      if (carrier !== undefined) { channels.set(channel, carrier); inspectCarrier(carrier); }
    }
    producers.set(producer.identity, Object.freeze({ producer, channels }));
  }
  const fileDemands: { readonly fileName: string; readonly usedNames: Set<string>;
    readonly arities: Set<number>; readonly clonedArities: Set<number> }[] = [];
  for (const file of input.sourceFiles) {
    const fileName = input.ast.getFileName(file);
    const usedNames = new Set<string>();
    const arities = new Set<number>();
    const clonedArities = new Set<number>();
    const registerConversion = (node: Node, conversion: RustCallableConversion): void => {
      const selected = rustCallableConversionErrorArities(conversion, input.definitions);
      if (selected === undefined) reject(node, "Callable conversion error joins have no exact physical channels.");
      else for (const arity of selected) arities.add(arity);
    };
    const registerAdapter = (node: Node, adapter: RustCallableValueAdapter, depth = 0): void => {
      if (depth > 128) { reject(node, "Callable error joins exceed their bounded adapter depth."); return; }
      if (adapter.kind === "conversion" && adapter.conversion.kind === "callable-adapter") registerConversion(node, adapter.conversion);
      else if (adapter.kind === "option-map" || adapter.kind === "option-some") registerAdapter(node, adapter.element, depth + 1);
    };
    const visit = (node: Node, enclosingRegion: Node): void => {
      if (!input.isNativeNode(node)) return;
      const localOwner = input.ast.is.IsSourceFile(node) || isSourceCallableBodyBoundary(input.ast, node)
        ? node : enclosingRegion;
      const sites = localSites.get(localOwner);
      if (sites === undefined) localSites.set(localOwner, [node]);
      else sites.push(node);
      for (const name of [input.names.nameForDeclaration(node), input.names.functionNameForDeclaration(node),
        input.names.callableValueNameForDeclaration(node)]) if (name !== undefined) usedNames.add(name);
      const effects = input.records.errorEffects.get(node);
      if (effects !== undefined) {
        const selected = regionFor(node, effects, true);
        if (selected !== undefined) regions.set(node, selected);
        const plannedRegion = localOwner === node;
        const asynchronous = input.records.asyncFunction.get(node);
        const settledPromise = asynchronous?.kind === "js-promise" && asynchronous.lowering.kind === "settled";
        const nativeRegion = selected?.jsRejection === undefined || input.promiseBodies.declarations.has(node);
        if (selected !== undefined && plannedRegion && !settledPromise && nativeRegion) {
          const arity = selected.sources.length + (selected.localOwner === undefined ? 0 : 1);
          if (arity > 1) arities.add(arity);
          if (effects.localErrors) registerRuntimeArm(fileName, arity, 0, node);
          if (asynchronous?.kind === "js-promise") clonedArities.add(arity);
        }
      }
      for (const edge of input.records.sourceErrorEffects.get(node)?.edges ?? []) {
        if (taskEdges.has(edge) || sourceRegions.has(edge)) continue;
        const selected = sourceRegionFor(node, edge);
        if (selected !== undefined) sourceRegions.set(edge, selected);
      }
      const conversion = input.records.contextualValueConversion.get(node)?.conversion;
      if (conversion?.kind === "callable-adapter") registerConversion(node, conversion);
      for (const adapter of input.records.projectCallableAdapters.get(node) ?? []) {
        registerAdapter(node, adapter.resultAdapter);
        for (const parameter of adapter.parameterAdapters) {
          if (parameter.kind === "runtime-value" || parameter.kind === "logical-value" || parameter.kind === "rest-element")
            registerAdapter(node, parameter.adapter);
          else if (parameter.kind === "rest") for (const segment of parameter.segments) registerAdapter(node, segment.adapter);
        }
      }
      const protectedBody = input.ast.is.IsTryStatement(node) && TryStatement_CatchClause(input.ast, node) !== undefined
        ? TryStatement_TryBlock(input.ast, node) : undefined;
      input.ast.forEachChild(node, child => {
        if (child !== undefined) visit(child, child === protectedBody ? child : localOwner);
      });
    };
    visit(file, file);
    const producerArities = input.callables.nativeGenericProducers.errorAritiesFor(fileName);
    if (producerArities === undefined) reject(file, "Native generic producers have no sealed exact error channels.");
    else for (const arity of producerArities) arities.add(arity);
    for (const definition of input.callables.frames.definitions) if (definition.ownerFileName === fileName) {
      for (const entry of definition.entries) {
        const selected = input.callables.frames.entryErrors(entry);
        inspectCarrier(selected.carrier);
        for (const transport of selected.implementations.values()) if (transport.kind === "mapped") {
          transport.transport.operand.sources.forEach(source => inspectCarrier(source.errorType));
        }
      }
    }
    for (const selected of input.callables.native.inputs) {
      if (selected.protocol.ownerFileName !== fileName) continue;
      usedNames.add(selected.protocol.targetName);
      if (selected.protocol.boundProducerName !== undefined) usedNames.add(selected.protocol.boundProducerName);
    }
    fileDemands.push({ fileName, usedNames, arities, clonedArities });
  }
  const empty: readonly RustErrorJoinDeclaration[] = Object.freeze([]);
  const reads = Object.freeze({
    get: (declaration: Node) => regions.get(declaration),
    sourceFor: (edge: RustSourceErrorEffectEdge) => sourceRegions.get(edge),
    producerError(reference: RustProducerErrorReference): TargetTypeRef | undefined {
      if (!isClosedMetadata(reference) || rustProducerErrorReference({ kind: "target-specific", target: "rust",
        name: "producer-error", value: reference }) === undefined) return undefined;
      const selected = producers.get(reference.identity);
      if (selected === undefined || selected.producer.fileName !== reference.fileName) return undefined;
      const carrier = selected.channels.get(reference.channel);
      const bindings = bindRustGenericArguments(selected.producer.environment, reference.genericArguments);
      return carrier === undefined || bindings === undefined ? undefined
        : normalizeRustErrorType(substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts),
          input, selected.producer.declaration);
    },
  });
  return diagnostics.length > 0 ? rejectedTargetStage(diagnostics) : resolvedTargetStage(Object.freeze({ ...reads,
    lifecycleFor(initializers: readonly RustInitializerSelection[], owner: RustPhysicalErrorOwner): TargetStageResult<RustLifecycleErrorSelection> {
      if (closed || lifecycleSelected) failTargetAnalysisInvariant("tsonic-rust", "The lifecycle error carrier has one selecting analysis owner before the error catalog seal.");
      lifecycleSelected = true;
      const file = input.sourceFiles.find(candidate => input.components.componentForFile(input.ast.getFileName(candidate))?.componentId === input.components.rootComponentId);
      if (file === undefined) return rejectedTargetStage([{ code: "RUST_LIFECYCLE_ERROR_OWNER_MISSING", category: "error", source: "tsonic-rust",
        message: "The program lifecycle requires its exact root component source owner.", evidence: ["target.capability=rust.analysis.error-regions"] }]);
      const fileName = input.ast.getFileName(file);
      if (input.nativeTasks.length === 0) return resolvedTargetStage(Object.freeze({ carrier: rustProgramErrorTargetType(owner),
        region: Object.freeze({ kind: "package", fileName, localOwner: owner, sources: Object.freeze([]) }) }));
      const pending = new Map<RustSourceErrorEffectEdge, RustSourceErrorRegionSelection>();
      for (const spawn of input.nativeTasks) for (const edge of input.records.sourceErrorEffects.get(spawn.node)?.edges ?? []) {
        if (pending.has(edge)) continue;
        const selected = sourceRegionFor(spawn.node, edge);
        if (selected !== undefined) pending.set(edge, selected);
      }
      const modules = new Map(initializers.flatMap(initializer => initializer.modules.map(module => [module.sourceFile, module] as const)));
      const rootLocal = [...modules.values()].some(module => module.region.kind === "package" && module.region.localOwner !== undefined &&
        closedMetadataKey(module.region.localOwner) === closedMetadataKey(owner)) ||
        input.binaryHooks.some(hook => hook.isFallible === true && hook.errorBoundary !== "provider-native") ||
        [...pending.values()].some(selected => selected.operand.localOwner !== undefined &&
          closedMetadataKey(selected.operand.localOwner) === closedMetadataKey(owner));
      const localOwner = rootLocal ? owner : undefined;
      const native = new Map<string, TargetTypeRef>();
      const add = (identity: string, type: TargetTypeRef, node: Node): void => {
        const carrier = normalizeRustErrorType(type, input, node);
        if (carrier === undefined) { reject(node, "A native lifecycle source requires its exact completed error carrier."); return; }
        if (isRustNeverCarrier(carrier) || carrier.kind === "target-named" && carrier.id === rustInfallibleTargetId) return;
        const previous = native.get(identity);
        if (previous !== undefined && !rustTargetTypeRefEquals(previous, carrier)) {
          reject(node, "One native lifecycle source has inconsistent completed payload carriers.");
          return;
        }
        native.set(identity, carrier);
        inspectCarrier(carrier);
      };
      for (const module of modules.values()) {
        if (module.region.kind === "infallible" || module.region.kind === "package" && module.region.localOwner !== undefined &&
          closedMetadataKey(module.region.localOwner) === closedMetadataKey(owner)) continue;
        const carrier = rustNativeErrorJoinTargetType(module.region.fileName,
          [...module.region.localOwner === undefined ? [] : [rustProgramErrorTargetType(module.region.localOwner)],
            ...module.region.sources.map(selected => selected.errorType)]);
        if (carrier === undefined) reject(module.sourceFile, "A native initializer requires its exact selected module error region.");
        else add(module.identity, carrier, module.sourceFile);
      }
      for (const [edge, selected] of pending) {
        const sourceOwner = selected.operand.localOwner;
        const sourceLocal = sourceOwner === undefined ? undefined : localOwner !== undefined &&
          closedMetadataKey(sourceOwner) === closedMetadataKey(localOwner) ? Object.freeze({ kind: "local" as const })
          : Object.freeze({ kind: "native" as const, targetIdentity: `native-task-local:${closedMetadataKey(sourceOwner)}` });
        if (sourceLocal?.kind === "native") add(sourceLocal.targetIdentity, rustProgramErrorTargetType(sourceOwner!), edge.declaration);
        for (const channel of selected.channels) {
          const source = selected.operand.sources.find(source => source.identity === channel.sourceIdentity);
          if (source === undefined) reject(edge.declaration, "A native task source requires its original instantiated error channel.");
          else add(channel.targetIdentity, source.errorType, edge.declaration);
        }
        sourceRegions.set(edge, Object.freeze({ ...selected, local: sourceLocal }));
      }
      for (const spawn of input.nativeTasks) {
        const branches = input.records.awaitSourceErrorEffects.get(spawn.node)?.branches ?? [];
        const selection = mapRustAwaitSelection(spawn.selection, leaf => {
          const future = leaf.future;
          if (future === undefined || future.awaiting !== "fallible") return leaf;
          if (future.errorBoundary === "source-program") {
            if (!branches.some(branch => rustTargetTypeRefEquals(branch.carrier, leaf.carrier) && pending.has(branch.edge))) {
              reject(spawn.node, "A native task body requires its exact original deferred source error edge.");
              return undefined;
            }
            return leaf;
          }
          const source = future.errorBoundary === "js-rejection" ? rustJsRejectionErrorIdentity : future.errorSource;
          const carrier = future.errorCarrier ?? (future.errorBoundary === "target-runtime" ? rustRuntimeErrorTargetType()
            : future.errorBoundary === "js-rejection" ? rustJsValueTargetType() : undefined);
          if (carrier === undefined) { reject(spawn.node, "A native task requires its actual provider or native error transport."); return undefined; }
          const errorCarrier = normalizeRustErrorType(carrier, input, spawn.node);
          if (errorCarrier === undefined) { reject(spawn.node, "A native task requires its closed physical native error payload."); return undefined; }
          const errorSource = source ?? `native-task-error:${closedMetadataKey({ boundary: future.errorBoundary, carrier: errorCarrier })}`;
          add(errorSource, errorCarrier, spawn.node);
          return { ...leaf, future: Object.freeze({ ...future, errorBoundary: "source-native" as const, errorCarrier, errorSource }) };
        });
        if (selection !== undefined) taskCompletions.set(spawn.node, snapshotClosedMetadata(selection));
      }
      for (const hook of input.binaryHooks) if (hook.isFallible === true && hook.errorBoundary === "provider-native")
        add(hook.id, hook.errorCarrier, file);
      const sources = snapshotRustNativeErrorSources([...native].map(([identity, errorType], index) =>
        ({ identity, errorType, variant: `Error${index + (localOwner === undefined ? 0 : 1)}` })), isRustTargetTypeRef);
      const carrier = sources === undefined ? undefined : rustNativeErrorJoinTargetType(fileName,
        [...localOwner === undefined ? [] : [rustProgramErrorTargetType(localOwner)], ...sources.map(source => source.errorType)]);
      if (sources === undefined || carrier === undefined) reject(file, "The lifecycle requires one bounded exact native error join.");
      if (diagnostics.length !== 0 || sources === undefined || carrier === undefined) return rejectedTargetStage(diagnostics);
      const region = Object.freeze({ kind: sources.length > 0 ? "native" as const : localOwner === undefined ? "infallible" as const : "package" as const,
        fileName, localOwner, sources });
      lifecycle = Object.freeze({ carrier, region });
      inspectCarrier(carrier);
      if (localOwner !== undefined) registerRuntimeArm(fileName, sources.length + 1, 0, file);
      return diagnostics.length === 0 ? resolvedTargetStage(lifecycle) : rejectedTargetStage(diagnostics);
    },
    taskCompletionFor(node: Node): RustAwaitSelection<RustAwaitValueLeafFact> | undefined {
      if (!lifecycleSelected) failTargetAnalysisInvariant("tsonic-rust", "Native task completions are read after their lifecycle transport is selected.", node);
      return taskCompletions.get(node);
    },
    complete(initialization: RustInitializationErrorRecords): RustErrorRegionRecords {
      if (closed || !lifecycleSelected) failTargetAnalysisInvariant("tsonic-rust", "The error catalog seals once after initialization and lifecycle composition.");
      closed = true;
      const localRegions = new Map<Node, RustErrorRegionSelection>();
      for (const [owner, sites] of localSites) {
        const file = input.ast.is.IsSourceFile(owner) ? input.ast.getSourceFile(owner) : undefined;
        const region = file === undefined ? regions.get(owner) : initialization.moduleFor(file)?.region ?? regions.get(owner);
        if (region === undefined && !input.ast.is.IsSourceFile(owner) && !isSourceCallableBodyBoundary(input.ast, owner))
          failTargetAnalysisInvariant("tsonic-rust", "A protected try body requires its completed local error-region evidence.", owner);
        if (region === undefined) continue;
        for (const node of sites) {
          if (localRegions.has(node)) failTargetAnalysisInvariant("tsonic-rust", "One local error-region owner publishes each runtime source subject once.", node);
          localRegions.set(node, region);
        }
      }
      localSites.clear();
      for (const { fileName, usedNames, arities, clonedArities } of fileDemands) {
        for (const arity of demandedArities.get(fileName) ?? []) arities.add(arity);
        declarations.set(fileName, Object.freeze([...arities].sort((left, right) => left - right).map(arity =>
          Object.freeze({ name: allocateRustGeneratedName(usedNames, `NativeErrors${arity}`), arity,
            clone: clonedArities.has(arity), runtimeErrorArm: runtimeErrorArms.get(fileName)?.get(arity) }))));
      }
      return Object.freeze({ ...reads, lifecycle, initialization,
        localFor: (node: Node) => localRegions.get(node),
        declarationsFor: (fileName: string) => declarations.get(fileName) ?? empty });
    },
  }));
}

export function completeRustErrorRegionRecords(
  regions: RustAnalyzedErrorRegions,
  initialization: RustInitializationErrorRecords,
): RustErrorRegionRecords {
  return regions.complete(initialization);
}
