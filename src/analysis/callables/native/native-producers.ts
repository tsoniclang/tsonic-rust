import type { AstReader, Node } from "@tsonic/tsts";
import { sourceNodeIdentity, sourceCallableValueParameters, type TargetSourceProgram } from "@tsonic/target-api/source";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { rustProducerErrorTargetType } from "../../../target-model/types/carriers/producer-errors.js";
import type { RustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustCallableProtocol, rustCallableInputProtocol, rustClosureTargetType } from "../../../target-model/types/carriers/callables.js";
import { rustNamedTargetType } from "../../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";
import { rustRuntimeCallableTargetType } from "../../../target-model/types/carriers/runtime-carriers.js";
import { rustNativeCallableCompletion } from "../../../policy/types/callables/native-completion.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

import { rustInfallibleTargetId } from "../../../target-model/types/carriers/source-types.js";
import type { RustDeferredProducerChannel } from "../../../target-model/records/errors/deferred-producer-effects.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import { createRustNativeOutwardResults } from "./native-outward-results.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import type { RustPhysicalCallableEmissionRequest } from "../ownership/physical-lifecycle.js";

type RustRequiredNativeProducer = Extract<RustPhysicalCallableEmissionRequest, { readonly kind: "producer" }>;
type RustNativeProducerPhysicalSelection =
  | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
  | { readonly kind: "unresolved" | "pending"; readonly reason: string };

export interface RustNativeCallableProducerConstruction extends RustNativeCallableProducerPlan {
  selectConstructionErrors(errors: ReadonlyMap<Node, TargetTypeRef>): void;
  seal(requests: readonly RustRequiredNativeProducer[]): TargetStageResult<RustNativeCallableProducerPlan>;
}

export function createRustNativeCallableProducerPlan(input: {
  readonly source: TargetSourceProgram;
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly native: Pick<RustNativeCallableInputPlan, "inputsFor" | "capturesFor">;
  readonly definitions: RustTypeDefinitions;
  readonly returnCarrierFor: (declaration: Node) => TargetTypeRef | undefined;
}): RustNativeCallableProducerConstruction {
  const byDeclaration = new Map<Node, RustNativeCallableProducer>();
  const byIdentity = new Map<string, RustNativeCallableProducer>();
  for (const declaration of input.nodes) {
    if (input.ast.body(declaration) === undefined) continue;
    const result = input.records.sourceCallableReturn.get(declaration);
    if (result === undefined) continue;
    const identity = sourceNodeIdentity(input.ast, declaration);
    const file = input.ast.getSourceFile(declaration);
    if (identity === undefined || file === undefined) continue;
    const fileName = input.ast.getFileName(file);
    const captures = input.records.closureCapture.get(declaration);
    const operation = input.records.targetOperation.get(declaration);
    const asynchronous = input.records.asyncFunction.get(declaration);
    const parameters = sourceCallableValueParameters(input.ast, declaration, input.source.semantics.forNode(declaration));
    if (parameters === undefined) continue;
    const inputs = input.native.inputsFor(declaration);
    const physicalInput = (parameter: Node, carrier: TargetTypeRef): TargetTypeRef => mapRustTargetTypes(carrier, current => {
      const selected = inputs.find(value => value.subject.node === parameter && rustTargetTypeRefEquals(value.carrier, current));
      return selected?.implementation ?? current;
    });
    const carriers = [result.returnCarrier,
      ...(parameters as readonly Node[]).flatMap(parameter => {
        const carrier = input.records.sourceParameterAbi.get(parameter)?.parameterCarrier;
        return carrier === undefined ? [] : [physicalInput(parameter, carrier)];
      }),
      ...[...captures?.captures ?? [], ...captures?.receiverFields ?? [], ...captures?.receivers ?? []].map(capture => capture.carrier),
      ...[...input.native.inputsFor(declaration), ...input.native.capturesFor(declaration)].flatMap(selected =>
        [selected.implementation, selected.trait]),
      ...(operation?.kind === "closure" ? [operation.resultCarrier] : []),
      ...(asynchronous === undefined ? [] : [asynchronous.futureCarrier]),
    ];
    const references = rustTargetGenericReferences({ kind: "tuple", elements: carriers });
    const retained = input.records.retainedEnvironment.get(declaration);
    const lifetimes = [...references.lifetimes];
    if (retained !== undefined && !lifetimes.some(lifetime => rustLifetimesEqual(lifetime, retained.lifetime)))
      lifetimes.push(retained.lifetime);
    const environment: readonly RustTargetGenericArgument[] = Object.freeze([
      ...lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
      ...references.typeParameters.map(type => ({ kind: "type" as const, type })),
      ...references.constParameters.map(value => ({ kind: "const" as const, value })),
    ]);
    const producer = Object.freeze({ declaration, identity: `${fileName}:${identity}`, fileName, environment });
    if (byIdentity.has(producer.identity)) failTargetAnalysisInvariant("tsonic-rust", "Native callable producer identity must be unique.", declaration);
    byDeclaration.set(declaration, producer);
    byIdentity.set(producer.identity, producer);
  }
  let published: RustNativeCallableProducerPlan | undefined;
  const sourceErrors = new Map<Node, Map<RustProducerErrorReference["channel"], TargetTypeRef>>();
  const errorFor = (declaration: Node, channel: RustProducerErrorReference["channel"]): TargetTypeRef | undefined => {
    if (published !== undefined) return published.errorFor(declaration, channel);
    const producer = byDeclaration.get(declaration);
    if (producer === undefined) return undefined;
    const previous = sourceErrors.get(declaration)?.get(channel);
    if (previous !== undefined) return previous;
    const selected = rustProducerErrorTargetType({
      identity: producer.identity, fileName: producer.fileName, channel, genericArguments: producer.environment,
    });
    const channels = sourceErrors.get(declaration) ?? new Map<RustProducerErrorReference["channel"], TargetTypeRef>();
    channels.set(channel, selected);
    sourceErrors.set(declaration, channels);
    return selected;
  };
  const noFuture: RustDeferredProducerChannel = Object.freeze({ awaiting: "infallible",
    errorCarrier: Object.freeze({ kind: "target-named", id: rustInfallibleTargetId }) });
  const deferredFor = (declaration: Node, ordinal: number): RustDeferredProducerChannel | undefined => {
    if (published !== undefined) return published.deferredFor(declaration, ordinal);
    if (!byDeclaration.has(declaration) || !Number.isSafeInteger(ordinal) || ordinal < 0) return undefined;
    const selected = input.records.deferredProducerEffects.get(declaration);
    if (selected?.kind !== "no-future") return selected?.channels[ordinal];
    const result = input.records.sourceCallableReturn.get(declaration);
    if (result === undefined) return undefined;
    const completion = rustNativeCallableCompletion(result.returnCarrier, input.definitions);
    return ordinal < Math.max(1, completion?.futures.length ?? 0) ? noFuture : undefined;
  };
  const resolving = new Set<string>();
  let constructionErrors: ReadonlyMap<Node, TargetTypeRef> | undefined;
  const outward = createRustNativeOutwardResults({ ...input, producers: {
    forDeclaration: declaration => byDeclaration.get(declaration), errorFor, deferredFor,
  } });
  const selectPhysical = (declaration: Node, carrier: TargetTypeRef): RustNativeProducerPhysicalSelection => {
    const unresolved = (reason: string): RustNativeProducerPhysicalSelection => Object.freeze({ kind: "unresolved", reason });
    const producer = byDeclaration.get(declaration);
    if (producer === undefined) return unresolved("A required native callable has no exact admitted source producer.");
    const signature = rustCallableProtocol(carrier);
    if (signature === undefined) return unresolved("A required native callable producer has no selected callable invocation protocol.");
    const retained = rustCallableInputProtocol(carrier) === undefined;
    if (retained && constructionErrors === undefined) return Object.freeze({ kind: "pending",
      reason: "Native retained constructors require their completed source-error ABI selection." });
    const intrinsic = errorFor(declaration, "invoke");
    const error = retained && constructionErrors?.has(declaration) ? constructionErrors.get(declaration) : intrinsic;
    if (error === undefined) return unresolved("A required native callable producer has no completed exact invocation error.");
    const operation = input.records.targetOperation.get(declaration);
    const sourceSignature = operation?.kind === "closure" ? rustCallableProtocol(
      input.records.receiverIndependentMethod.get(declaration)?.carrier ?? operation.resultCarrier) : undefined;
    const asynchronous = input.records.asyncFunction.get(declaration);
    const parameters = sourceCallableValueParameters(input.ast, declaration, input.source.semantics.forNode(declaration));
    if (parameters === undefined) return unresolved("A native producer requires its exact checked value parameters.");
    const expectedParameters = sourceSignature?.parameters ?? parameters.map(parameter =>
      input.records.sourceParameterAbi.get(parameter)?.parameterCarrier);
    const expectedResult = sourceSignature?.result ?? asynchronous?.futureCarrier ??
      input.records.sourceCallableReturn.get(declaration)?.returnCarrier;
    if (expectedParameters.length !== signature.parameters.length ||
      !expectedParameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, signature.parameters[index])) ||
      !rustTargetTypeRefEquals(expectedResult, signature.result))
      return unresolved("A required native callable producer does not match its exact source parameter and result ABI.");
    const key = `${producer.identity}:${closedMetadataKey(carrier)}`;
    if (resolving.has(key) || resolving.size >= 128)
      return unresolved("A required native callable producer exceeds its bounded physical result selection.");
    resolving.add(key);
    let resultCarrier: TargetTypeRef | undefined;
    try { resultCarrier = outward.invocationFor(declaration); }
    finally { resolving.delete(key); }
    if (resultCarrier === undefined) return unresolved("A required native callable producer has no completed exact invocation result.");
    if (retained && signature.lifetime === undefined)
      return unresolved("A required retained native callable producer has no exact construction lifetime.");
    const arguments_: TargetTypeRef = { kind: "tuple", elements: signature.parameters };
    const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([resultCarrier, error]));
    const physical = retained
      ? rustRuntimeCallableTargetType(signature.lifetime!, signature.parameters, result)
      : rustClosureTargetType([arguments_], result);
    return Object.freeze({ kind: "selected", carrier: physical });
  };
  const plan: RustNativeCallableProducerPlan = Object.freeze({ producers: Object.freeze([...byDeclaration.values()]), errorFor,
    outwardReturnFor: (declaration: Node) => published === undefined ? outward.returnFor(declaration) : published.outwardReturnFor(declaration),
    invocationResultFor: (declaration: Node) => published === undefined ? outward.invocationFor(declaration) : published.invocationResultFor(declaration),
    bodyResultFor: (declaration: Node) => published === undefined ? outward.bodyFor(declaration) : published.bodyResultFor(declaration),
    forDeclaration: (declaration: Node) => byDeclaration.get(declaration),
    forIdentity: (identity: string) => byIdentity.get(identity),
    deferredFor,
    deferredErrorFor: (declaration: Node, ordinal: number) => deferredFor(declaration, ordinal)?.errorCarrier,
    physicalFor(declaration: Node, carrier: TargetTypeRef): TargetTypeRef | undefined {
      if (published !== undefined) return published.physicalFor(declaration, carrier);
      const selected = selectPhysical(declaration, carrier);
      if (selected.kind === "pending") failTargetAnalysisInvariant("tsonic-rust", selected.reason, declaration);
      return selected.kind === "selected" ? selected.carrier : undefined;
    },
  });
  let sealed = false;
  return Object.freeze({ ...plan,
    selectConstructionErrors(errors: ReadonlyMap<Node, TargetTypeRef>): void {
      if (sealed || constructionErrors !== undefined || [...errors.keys()].some(declaration => !byDeclaration.has(declaration)))
        failTargetAnalysisInvariant("tsonic-rust", "Native retained construction errors select once from exact admitted producer declarations.");
      constructionErrors = new Map(errors);
    },
    seal(requests: readonly RustRequiredNativeProducer[]): TargetStageResult<RustNativeCallableProducerPlan> {
      if (sealed) failTargetAnalysisInvariant("tsonic-rust", "Native callable producer results seal exactly once after selected effects and storage.");
      if (!Array.isArray(requests)) failTargetAnalysisInvariant("tsonic-rust", "Native callable producer sealing requires its complete selecting-owner request vector.");
      sealed = true;
      const diagnostics: TargetDiagnostic[] = [];
      const physical = new Map<Node, Map<string, RustNativeProducerPhysicalSelection>>();
      for (const request of requests) {
        let selection: RustNativeProducerPhysicalSelection;
        if (!byDeclaration.has(request.declaration)) selection = selectPhysical(request.declaration, request.carrier);
        else {
          const selections = physical.get(request.declaration) ?? new Map<string, RustNativeProducerPhysicalSelection>();
          const key = closedMetadataKey(request.carrier);
          selection = selections.get(key) ?? selectPhysical(request.declaration, request.carrier);
          selections.set(key, selection);
          physical.set(request.declaration, selections);
        }
        if (selection.kind !== "selected") diagnostics.push({ code: "RUST_NATIVE_CALLABLE_PRODUCER_NOT_PROVEN", category: "error",
          source: "tsonic-rust", sourceNode: request.subject, message: selection.reason,
          evidence: ["rust.callable-value.required-native-producer", `role=${request.context.role}`,
            `contract=${request.context.enclosingContract}`,
            ...(request.context.specialization === undefined ? [] : [`specialization=${request.context.specialization}`])] });
      }
      if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
      const errors = new Map<Node, ReadonlyMap<RustProducerErrorReference["channel"], TargetTypeRef>>();
      const deferred = new Map<Node, ReadonlyMap<number, RustDeferredProducerChannel>>();
      const outwardReturns = new Map<Node, TargetTypeRef>();
      const invocationResults = new Map<Node, TargetTypeRef>();
      const bodyResults = new Map<Node, TargetTypeRef>();
      for (const producer of plan.producers) {
        const declaration = producer.declaration;
        const result = input.records.sourceCallableReturn.get(declaration);
        const asynchronous = input.records.asyncFunction.get(declaration);
        const logical = asynchronous?.futureCarrier ?? result?.returnCarrier;
        const completion = logical === undefined ? undefined : rustNativeCallableCompletion(logical, input.definitions);
        const channels = new Map<RustProducerErrorReference["channel"], TargetTypeRef>();
        for (const channel of ["invoke", "body", ...Array.from({ length: Math.max(1, completion?.futures.length ?? 0) },
          (_value, index) => index)] as const) {
          const selected = plan.errorFor(declaration, channel);
          if (selected !== undefined) channels.set(channel, selected);
        }
        errors.set(declaration, channels);
        const completions = new Map<number, RustDeferredProducerChannel>();
        for (let ordinal = 0; ordinal < Math.max(1, completion?.futures.length ?? 0); ordinal += 1) {
          const selected = plan.deferredFor(declaration, ordinal);
          if (selected !== undefined) completions.set(ordinal, selected);
        }
        deferred.set(declaration, completions);
        const outwardResult = plan.outwardReturnFor(declaration);
        const invocationResult = plan.invocationResultFor(declaration);
        const bodyResult = plan.bodyResultFor(declaration);
        if (outwardResult !== undefined) outwardReturns.set(declaration, outwardResult);
        if (invocationResult !== undefined) invocationResults.set(declaration, invocationResult);
        if (bodyResult !== undefined) bodyResults.set(declaration, bodyResult);
      }
      const physicalCarriers = new Map<Node, ReadonlyMap<string, TargetTypeRef>>();
      for (const [declaration, selections] of physical) {
        const carriers = new Map<string, TargetTypeRef>();
        for (const [key, selection] of selections) {
          if (selection.kind !== "selected") failTargetAnalysisInvariant("tsonic-rust", "Admitted native producer storage requires its selected physical carrier.", declaration);
          carriers.set(key, selection.carrier);
        }
        physicalCarriers.set(declaration, carriers);
      }
      published = sealRustNativeCallableProducers({ byDeclaration, byIdentity, errors, deferred, outwardReturns,
        invocationResults, bodyResults, physical: physicalCarriers });
      return resolvedTargetStage(published);
    },
  });
}

import type { RustNativeCallableProducer, RustNativeCallableProducerPlan } from "../../../target-model/records/native/native-producers.js";
import { sealRustNativeCallableProducers } from "../../program/records/native/native-producers.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
