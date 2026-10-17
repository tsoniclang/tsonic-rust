import type { AstReader, Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustProducerErrorTargetType } from "../../target-model/types/carriers/producer-errors.js";
import type { RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { rustCallableProtocol, rustCallableInputProtocol, rustClosureTargetType } from "../../target-model/types/carriers/callables.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments, rustLifetimeGenericArgument } from "../../target-model/types/generic-arguments.js";
import { rustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";

import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import type { RustDeferredProducerChannel } from "../../target-model/records/deferred-producer-effects.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import { createRustNativeOutwardResults } from "./native-outward-results.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";

export interface RustNativeCallableProducer {
  readonly declaration: Node;
  readonly identity: string;
  readonly fileName: string;
  readonly environment: readonly RustTargetGenericArgument[];
}

export interface RustNativeCallableProducerPlan {
  readonly producers: readonly RustNativeCallableProducer[];
  forDeclaration(declaration: Node): RustNativeCallableProducer | undefined;
  forIdentity(identity: string): RustNativeCallableProducer | undefined;
  errorFor(declaration: Node, channel: RustProducerErrorReference["channel"]): TargetTypeRef | undefined;
  deferredFor(declaration: Node, ordinal: number): RustDeferredProducerChannel | undefined;
  deferredErrorFor(declaration: Node, ordinal: number): TargetTypeRef | undefined;
  outwardReturnFor(declaration: Node): TargetTypeRef | undefined;
  invocationResultFor(declaration: Node): TargetTypeRef | undefined;
  bodyResultFor(declaration: Node): TargetTypeRef | undefined;
  physicalFor(declaration: Node, carrier: TargetTypeRef): TargetTypeRef | undefined;
}

export interface RustNativeCallableProducerConstruction extends RustNativeCallableProducerPlan {
  selectConstructionErrors(errors: ReadonlyMap<Node, TargetTypeRef>): void;
  seal(requests: ReadonlyMap<Node, readonly TargetTypeRef[]>): RustNativeCallableProducerPlan;
}

export function createRustNativeCallableProducerPlan(input: {
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
    const parameters = input.ast.parameters(declaration);
    if (parameters.some(parameter => parameter === undefined)) continue;
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
    const environment: readonly RustTargetGenericArgument[] = Object.freeze([
      ...references.lifetimes.map(lifetime => ({ kind: "lifetime" as const, lifetime })),
      ...references.typeParameters.map(type => ({ kind: "type" as const, type })),
      ...references.constParameters.map(value => ({ kind: "const" as const, value })),
    ]);
    const producer = Object.freeze({ declaration, identity: `${fileName}:${identity}`, fileName, environment });
    if (byIdentity.has(producer.identity)) throw new Error("Native callable producer identity must be unique.");
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
      const producer = byDeclaration.get(declaration);
      const signature = rustCallableProtocol(carrier);
      const intrinsic = errorFor(declaration, "invoke");
      const retained = rustCallableInputProtocol(carrier) === undefined;
      if (retained && constructionErrors === undefined)
        throw new Error("Native retained constructors require their completed source-error ABI selection.");
      const error = retained && constructionErrors?.has(declaration) ? constructionErrors.get(declaration) : intrinsic;
      if (producer === undefined || signature === undefined || error === undefined) return undefined;
      const operation = input.records.targetOperation.get(declaration);
      const sourceSignature = operation?.kind === "closure" ? rustCallableProtocol(
        input.records.receiverIndependentMethod.get(declaration)?.carrier ?? operation.resultCarrier) : undefined;
      const asynchronous = input.records.asyncFunction.get(declaration);
      const expectedParameters = sourceSignature?.parameters ?? input.ast.parameters(declaration).map(parameter =>
        input.records.sourceParameterAbi.get(parameter)?.parameterCarrier);
      const expectedResult = sourceSignature?.result ?? asynchronous?.futureCarrier ??
        input.records.sourceCallableReturn.get(declaration)?.returnCarrier;
      if (expectedParameters.length !== signature.parameters.length ||
        !expectedParameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, signature.parameters[index])) ||
        !rustTargetTypeRefEquals(expectedResult, signature.result)) return undefined;
      const key = `${producer.identity}:${closedMetadataKey(carrier)}`;
      if (resolving.has(key) || resolving.size >= 128) return undefined;
      resolving.add(key);
      let resultCarrier: TargetTypeRef | undefined;
      try { resultCarrier = outward.invocationFor(declaration); }
      finally { resolving.delete(key); }
      if (resultCarrier === undefined) return undefined;
      const arguments_: TargetTypeRef = { kind: "tuple", elements: signature.parameters };
      const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([resultCarrier, error]));
      return rustCallableInputProtocol(carrier) === undefined
        ? signature.lifetime === undefined ? undefined
          : rustNamedTargetType("rust.runtime.Callable", "rt::Callable", [rustLifetimeGenericArgument(signature.lifetime),
            ...rustTypeGenericArguments([arguments_, result])])
        : rustClosureTargetType([arguments_], result);
    },
  });
  let sealed = false;
  return Object.freeze({ ...plan,
    selectConstructionErrors(errors: ReadonlyMap<Node, TargetTypeRef>): void {
      if (constructionErrors !== undefined || [...errors.keys()].some(declaration => !byDeclaration.has(declaration)))
        throw new Error("Native retained construction errors select once from exact admitted producer declarations.");
      constructionErrors = new Map(errors);
    },
    seal(requests: ReadonlyMap<Node, readonly TargetTypeRef[]>): RustNativeCallableProducerPlan {
      if (sealed) throw new Error("Native callable producer results seal exactly once after selected effects and storage.");
      const errors = new Map<Node, ReadonlyMap<RustProducerErrorReference["channel"], TargetTypeRef>>();
      const deferred = new Map<Node, ReadonlyMap<number, RustDeferredProducerChannel>>();
      const outwardReturns = new Map<Node, TargetTypeRef>();
      const invocationResults = new Map<Node, TargetTypeRef>();
      const bodyResults = new Map<Node, TargetTypeRef>();
      const physical = new Map<Node, ReadonlyMap<string, TargetTypeRef | undefined>>();
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
        const selections = new Map<string, TargetTypeRef | undefined>();
        for (const carrier of requests.get(declaration) ?? []) {
          const key = closedMetadataKey(carrier);
          if (!selections.has(key)) selections.set(key, plan.physicalFor(declaration, carrier));
        }
        physical.set(declaration, selections);
      }
      sealed = true;
      published = Object.freeze({ producers: plan.producers, forDeclaration: plan.forDeclaration, forIdentity: plan.forIdentity,
        errorFor: (declaration: Node, channel: RustProducerErrorReference["channel"]) => errors.get(declaration)?.get(channel),
        deferredFor: (declaration: Node, ordinal: number) => deferred.get(declaration)?.get(ordinal),
        deferredErrorFor: (declaration: Node, ordinal: number) => deferred.get(declaration)?.get(ordinal)?.errorCarrier,
        outwardReturnFor: (declaration: Node) => outwardReturns.get(declaration),
        invocationResultFor: (declaration: Node) => invocationResults.get(declaration),
        bodyResultFor: (declaration: Node) => bodyResults.get(declaration),
        physicalFor: (declaration: Node, carrier: TargetTypeRef) => physical.get(declaration)?.get(closedMetadataKey(carrier)),
      });
      return published;
    },
  });
}
