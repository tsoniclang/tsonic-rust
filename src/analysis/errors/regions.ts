import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustErrorJoinDeclaration, RustErrorRegionRecords, RustErrorRegionSelection,
  RustInitializationErrorRecords, RustSourceErrorRegionSelection, RustPhysicalErrorOwner } from "../../target-model/records/error-regions.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustCallableConversion } from "../../target-model/conversions/callable.js";
import { rustCallableConversionErrorArities } from "../../target-model/conversions/callable-physical.js";
import type { RustHelperCallableEmissionRequest } from "../callables/emission-adapters.js";
import type { RustNativeCallableProducer } from "../callables/native-producers.js";
import type { RustCallableValuePlan } from "../callables/value-plan.js";
import type { RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { rustProducerErrorReference, rustProducerErrorTargetType } from "../../target-model/types/carriers/producer-errors.js";
import { bindRustGenericArguments } from "../../target-model/types/carriers/generic-argument-bindings.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { normalizeRustErrorType, selectRustPhysicalProgramErrorOwner, type RustErrorTypeContext } from "./error-types.js";
import { rustNativeErrorJoinReference, rustNativeErrorJoinTargetType } from "../../target-model/types/native-error-joins.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import { closedMetadataEquals, isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { snapshotRustNativeErrorSources } from "../../target-model/types/native-error-joins.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import { selectRustJsRejectionRegion } from "./js-rejection.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import type { RustPromiseBodies } from "../../target-model/records/callables-and-resources.js";
import { selectRustNativeTypeCarrier, type RustNativeTypeSelectionInput } from "../../policy/types/model/native-type-selection.js";
import { rustNamedTypeCarrierValue } from "../../target-model/types/carriers/native.js";
import { rustProgramErrorTargetType } from "../../target-model/types/carriers/js.js";
import { rustRuntimeErrorTypeIdentity } from "../../target-model/operations/error-boundary.js";
import type { RustEmissionErrorContext, RustPhysicalEmissionOperand } from "../../target-model/records/physical-emission-contexts.js";

export interface RustAnalyzedErrorRegions extends Pick<RustErrorRegionRecords, "producerError" | "declarationsFor"> {
  readonly get: (declaration: Node) => RustErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>> | undefined;
  readonly sourceFor: (edge: RustSourceErrorEffectEdge) => RustSourceErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>> | undefined;
}

export function analyzeRustErrorRegions(input: RustErrorTypeContext & {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly callables: Pick<RustCallableValuePlan, "native" | "nativeGenericProducers">;
  readonly promiseBodies: RustPromiseBodies;
  readonly helperEmissionRequests: readonly RustHelperCallableEmissionRequest[];
}): TargetStageResult<RustAnalyzedErrorRegions> {
  const regions = new Map<Node, RustErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>>>();
  const sourceRegions = new Map<RustSourceErrorEffectEdge, RustSourceErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>>>();
  const declarations = new Map<string, readonly RustErrorJoinDeclaration[]>();
  const demandedArities = new Map<string, Set<number>>();
  const producers = new Map<string, {
    readonly producer: RustNativeCallableProducer;
    readonly channels: ReadonlyMap<RustProducerErrorReference["channel"], TargetTypeRef>;
  }>();
  const diagnostics: TargetDiagnostic[] = [];
  const reject = (node: Node, message: string): void => {
    diagnostics.push({ code: "RUST_ERROR_REGION_UNRESOLVED", category: "error", source: "tsonic-rust",
      sourceNode: node, message, evidence: ["target.capability=rust.analysis.error-regions"] });
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
  const regionFor = (node: Node, effects: RustErrorEffectsFact, body = false):
    RustErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>> | undefined => {
    const file = input.ast.getSourceFile(node);
    const owner = effects.localErrors ? selectRustPhysicalProgramErrorOwner(node, input) : undefined;
    const sources = effects.nativeErrors.map((source, index) => {
      const errorType = normalizeRustErrorType(source.errorType, input, node);
      if (errorType !== undefined) inspectCarrier(errorType);
      return errorType === undefined ? undefined : Object.freeze({ identity: source.identity,
        variant: `Error${index + (effects.localErrors ? 1 : 0)}`, errorType });
    });
    if (file === undefined || effects.localErrors && owner === undefined || sources.some(source => source === undefined)) {
      reject(node, "An error region has no exact physical package owner or native payload carrier.");
      return undefined;
    }
    const selectedSources = snapshotRustNativeErrorSources(sources as NonNullable<typeof sources[number]>[], isRustTargetTypeRef);
    if (selectedSources === undefined || selectedSources.length + (owner === undefined ? 0 : 1) > 4096) {
      reject(node, "An error region exceeds its bounded exact native error-source contract.");
      return undefined;
    }
    const closure = body ? input.records.targetOperation.get(node) : undefined;
    const callback = closure?.kind === "closure" ? rustCallableProtocol(closure.resultCarrier) : undefined;
    const promiseBody = body && (input.promiseBodies.objects.has(node) ||
      rustTargetTypeRefEquals(callback?.error, rustJsValueTargetType()));
    const jsRejection = promiseBody ? selectRustJsRejectionRegion(owner, selectedSources) : undefined;
    if (promiseBody && jsRejection === undefined) {
      reject(node, "A JS Promise rejection region has no bounded exact native conversion selection.");
      return undefined;
    }
    return Object.freeze({ kind: effects.nativeErrors.length > 0 ? "native" : effects.localErrors ? "package" : "infallible",
      fileName: input.ast.getFileName(file), localOwner: owner,
      sources: selectedSources, ...(jsRejection === undefined ? {} : { jsRejection }) });
  };
  const sourceRegionFor = (node: Node, edge: RustSourceErrorEffectEdge): void => {
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
    const operand = regionFor(edge.declaration, { localErrors: source.localErrors,
      nativeErrors: instantiated as NonNullable<typeof instantiated[number]>[] });
    if (operand === undefined) return;
    sourceRegions.set(edge, Object.freeze({ operand, channels: Object.freeze(operand.sources.map(selected =>
      Object.freeze({ sourceIdentity: selected.identity, targetIdentity: channels.get(selected.identity)!.target.identity,
        uninhabited: isRustNeverCarrier(selected.errorType) || selected.errorType.kind === "target-named" &&
          selected.errorType.id === rustInfallibleTargetId }))) }));
  };
  for (const producer of input.producers.producers) {
    const asynchronous = input.records.asyncFunction.get(producer.declaration);
    const result = asynchronous?.futureCarrier ?? input.records.sourceCallableReturn.get(producer.declaration)?.returnCarrier;
    const completion = result === undefined ? undefined : rustNativeCallableCompletion(result, input.definitions);
    const channels = new Map<RustProducerErrorReference["channel"], TargetTypeRef>();
    const body: readonly RustProducerErrorReference["channel"][] = asynchronous === undefined ? [] : ["body"];
    for (const channel of ["invoke" as const, ...body, ...Array.from({ length: completion?.futures.length ?? 0 }, (_value, index) => index)]) {
      const carrier = normalizeRustErrorType(rustProducerErrorTargetType({ identity: producer.identity,
        fileName: producer.fileName, channel, genericArguments: producer.environment }), input);
      if (carrier !== undefined) { channels.set(channel, carrier); inspectCarrier(carrier); }
    }
    producers.set(producer.identity, Object.freeze({ producer, channels }));
  }
  const fileDemands: { readonly fileName: string; readonly usedNames: Set<string>;
    readonly arities: Set<number>; readonly clonedArities: Set<number> }[] = [];
  const registerConversion = (node: Node, conversion: RustCallableConversion, arities: Set<number>): void => {
    const selected = rustCallableConversionErrorArities(conversion, input.definitions);
    if (selected === undefined) reject(node, "Callable conversion error joins have no exact physical channels.");
    else for (const arity of selected) arities.add(arity);
  };
  for (const helper of input.helperEmissionRequests) {
    const arities = demandedArities.get(helper.nativeOwnerFileName) ?? new Set<number>();
    for (const adapter of helper.callableAdapterInputs) registerConversion(adapter.node, adapter.selection, arities);
    demandedArities.set(helper.nativeOwnerFileName, arities);
  }
  for (const file of input.sourceFiles) {
    const fileName = input.ast.getFileName(file);
    const usedNames = new Set<string>();
    const arities = new Set<number>();
    const clonedArities = new Set<number>();
    const visit = (node: Node): void => {
      if (!input.isNativeNode(node)) return;
      for (const name of [input.names.nameForDeclaration(node), input.names.functionNameForDeclaration(node),
        input.names.callableValueNameForDeclaration(node)]) if (name !== undefined) usedNames.add(name);
      const effects = input.records.errorEffects.get(node);
      if (effects !== undefined) {
        const selected = regionFor(node, effects, true);
        if (selected !== undefined) regions.set(node, selected);
        if (effects.nativeErrors.length > 0) {
          const arity = effects.nativeErrors.length + (effects.localErrors ? 1 : 0);
          if (arity > 1) arities.add(arity);
          if (input.records.asyncFunction.get(node)?.kind === "js-promise") clonedArities.add(arity);
        }
      }
      for (const edge of input.records.sourceErrorEffects.get(node)?.edges ?? []) sourceRegionFor(node, edge);
      for (const branch of input.records.awaitSourceErrorEffects.get(node)?.branches ?? []) sourceRegionFor(node, branch.edge);
      const conversion = input.records.contextualValueConversion.get(node)?.conversion;
      if (conversion?.kind === "callable-adapter") registerConversion(node, conversion, arities);
      input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
    const producerArities = input.callables.nativeGenericProducers.errorAritiesFor(fileName);
    if (producerArities === undefined) reject(file, "Native generic producers have no sealed exact error channels.");
    else for (const arity of producerArities) arities.add(arity);
    for (const selected of input.callables.native.inputs) {
      if (selected.protocol.ownerFileName !== fileName) continue;
      usedNames.add(selected.protocol.targetName);
      if (selected.protocol.boundProducerName !== undefined) usedNames.add(selected.protocol.boundProducerName);
    }
    fileDemands.push({ fileName, usedNames, arities, clonedArities });
  }
  for (const { fileName, usedNames, arities, clonedArities } of fileDemands) {
    for (const arity of demandedArities.get(fileName) ?? []) arities.add(arity);
    declarations.set(fileName, Object.freeze([...arities].sort((left, right) => left - right).map(arity =>
      Object.freeze({ name: allocateRustGeneratedName(usedNames, `NativeErrors${arity}`), arity,
        clone: clonedArities.has(arity) }))));
  }
  const empty: readonly RustErrorJoinDeclaration[] = Object.freeze([]);
  return diagnostics.length > 0 ? rejectedTargetStage(diagnostics) : resolvedTargetStage(Object.freeze({
    get: (declaration: Node) => regions.get(declaration),
    sourceFor: (edge: RustSourceErrorEffectEdge) => sourceRegions.get(edge),
    declarationsFor: (fileName: string) => declarations.get(fileName) ?? empty,
    producerError(reference: RustProducerErrorReference): TargetTypeRef | undefined {
      if (!isClosedMetadata(reference) || rustProducerErrorReference({ kind: "target-specific", target: "rust",
        name: "producer-error", value: reference }) === undefined) return undefined;
      const selected = producers.get(reference.identity);
      if (selected === undefined || selected.producer.fileName !== reference.fileName) return undefined;
      const carrier = selected.channels.get(reference.channel);
      const bindings = bindRustGenericArguments(selected.producer.environment, reference.genericArguments);
      return carrier === undefined || bindings === undefined ? undefined
        : substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts);
    },
  }));
}

export function completeRustErrorRegionRecords(
  regions: RustAnalyzedErrorRegions,
  initialization: RustInitializationErrorRecords,
): RustErrorRegionRecords {
  return Object.freeze({ declarationsFor: regions.declarationsFor, producerError: regions.producerError, initialization });
}

export function publishRustNativeErrorSources(
  sources: readonly RustNativeErrorSource<TargetTypeRef>[],
  node: Node,
  input: RustNativeTypeSelectionInput,
): TargetStageResult<RustErrorRegionSelection["sources"]> {
  const selected: RustErrorRegionSelection["sources"][number][] = [];
  const diagnostics: TargetDiagnostic[] = [];
  for (const source of sources) {
    const native = selectRustNativeTypeCarrier(source.errorType, input, "general");
    if (native.kind === "rejected") diagnostics.push({ code: "RUST_NATIVE_ERROR_PAYLOAD_NOT_REPRESENTABLE",
      category: "error", source: "tsonic-rust", sourceNode: node,
      message: native.reason, evidence: ["target.capability=rust.native-error-payload"] });
    else selected.push(Object.freeze({ ...source, nativeType: native.carrier }));
  }
  return diagnostics.length === 0 ? resolvedTargetStage(Object.freeze(selected)) : rejectedTargetStage(diagnostics);
}

export function prepareRustErrorRegion(
  region: RustErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>>,
  apply: (carrier: TargetTypeRef) => TargetTypeRef,
): RustErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>> {
  const conversion = (selected: import("../../target-model/records/error-regions.js").RustJsRejectionConversion):
    import("../../target-model/records/error-regions.js").RustJsRejectionConversion => selected.kind === "native-join"
      ? Object.freeze({ ...selected, carrier: apply(selected.carrier), arms: Object.freeze(selected.arms.map(conversion)) })
      : Object.freeze({ ...selected, carrier: apply(selected.carrier) });
  return Object.freeze({ ...region,
    sources: Object.freeze(region.sources.map(source => Object.freeze({ ...source, errorType: apply(source.errorType) }))),
    ...(region.jsRejection === undefined ? {} : { jsRejection: Object.freeze({
      local: region.jsRejection.local === undefined ? undefined : conversion(region.jsRejection.local),
      sources: Object.freeze(region.jsRejection.sources.map(source => Object.freeze({ ...source, conversion: conversion(source.conversion) }))),
      requiredCarriers: Object.freeze(region.jsRejection.requiredCarriers.map(apply)),
    }) }) });
}

export function publishRustErrorRegion(
  region: RustErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>>,
  node: Node,
  input: RustNativeTypeSelectionInput,
): TargetStageResult<RustErrorRegionSelection> {
  const sources = publishRustNativeErrorSources(region.sources, node, input);
  return sources.kind === "rejected" ? sources : resolvedTargetStage(Object.freeze({ ...region, sources: sources.value }));
}

export function selectRustNativeInvocationErrorPropagation(
  node: Node,
  error: TargetTypeRef,
  context: RustEmissionErrorContext,
  sources: RustPhysicalEmissionOperand["sourceErrorRegions"],
  sourceProgramOwner: RustPhysicalErrorOwner | undefined,
  input: RustNativeTypeSelectionInput,
): TargetStageResult<Extract<RustPhysicalEmissionOperand["nativeCallResult"], { readonly kind: "result" }>["propagation"]> {
  const reject = (message: string) => rejectedTargetStage<
    Extract<RustPhysicalEmissionOperand["nativeCallResult"], { readonly kind: "result" }>["propagation"]>([{
    code: "RUST_NATIVE_CALL_RESULT_NOT_PROVEN", category: "error" as const, source: "tsonic-rust",
    sourceNode: node, message,
  }]);
  if (rustNamedTypeCarrierValue(error)?.id === rustInfallibleTargetId)
    return resolvedTargetStage(Object.freeze({ kind: "infallible" }));
  if (context.kind === "none") return reject("A fallible retained invocation requires its original selected physical error context.");
  let selected: RustSourceErrorRegionSelection | undefined;
  for (const source of sources) {
    if (source.edge.kind !== "invoke") continue;
    const region = source.selection.operand;
    const carrier = rustNativeErrorJoinTargetType(region.fileName, [
      ...region.localOwner === undefined ? [] : [rustProgramErrorTargetType(region.localOwner)],
      ...region.sources.map(source => source.nativeType),
    ]);
    if (carrier === undefined) return reject("A native invocation requires its original complete error-region carrier.");
    const native = selectRustNativeTypeCarrier(carrier, input, "general");
    if (native.kind === "rejected") return reject(native.reason);
    if (!rustTargetTypeRefEquals(error, native.carrier)) continue;
    if (selected !== undefined && !closedMetadataEquals(selected, source.selection))
      return reject("Native invocation alternatives require identical original error-channel correspondence.");
    selected = source.selection;
  }
  if (selected !== undefined) return resolvedTargetStage(Object.freeze({ kind: "source", selection: selected }));
  const localOwner = context.kind === "region" ? context.region.localOwner
    : context.initializer.error.kind === "infallible" ? undefined : context.initializer.error.owner;
  if (localOwner === undefined) return reject("A retained native invocation has no exact admitted destination for a program error.");
  if (sourceProgramOwner !== undefined) {
    const local = selectRustNativeTypeCarrier(rustProgramErrorTargetType(sourceProgramOwner), input, "general");
    if (local.kind === "rejected") return reject(local.reason);
    if (!rustTargetTypeRefEquals(error, local.carrier))
      return reject("A native frame invocation must retain its original defining package error identity.");
    return resolvedTargetStage(Object.freeze({ kind: "local" }));
  }
  if (rustNamedTypeCarrierValue(error)?.nativeErrorIdentity === rustRuntimeErrorTypeIdentity)
    return resolvedTargetStage(Object.freeze({ kind: "local" }));
  const local = selectRustNativeTypeCarrier(rustProgramErrorTargetType(localOwner), input, "general");
  if (local.kind === "rejected") return reject(local.reason);
  if (rustTargetTypeRefEquals(error, local.carrier)) return resolvedTargetStage(Object.freeze({ kind: "local" }));
  return reject("A retained native invocation requires its original exact source or package error channel.");
}
