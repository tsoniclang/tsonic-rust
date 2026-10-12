import type { AstReader, Node } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustProducerErrorTargetType } from "../../target-model/types/carriers/producer-errors.js";
import { rustCallableProtocol, rustCallableInputProtocol, rustClosureTargetType } from "../../target-model/types/carriers/callables.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { rustNativeCallableCompletion, instantiateRustNativeCompletion, rustNativeCompletionFutureType } from "../../target-model/types/callable-completions.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustAsyncFunctionFactKey, rustClosureCaptureFactKey, rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey, rustDeferredProducerEffectsFactKey } from "../facts/keys.js";
import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import type { RustDeferredProducerChannel } from "../facts/deferred-producer-effects.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";

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
  errorFor(declaration: Node, channel: "invoke" | number): TargetTypeRef | undefined;
  deferredFor(declaration: Node, ordinal: number): RustDeferredProducerChannel | undefined;
  deferredErrorFor(declaration: Node, ordinal: number): TargetTypeRef | undefined;
  physicalFor(declaration: Node, carrier: TargetTypeRef): TargetTypeRef | undefined;
}

export function createRustNativeCallableProducerPlan(input: {
  readonly ast: AstReader;
  readonly nodes: readonly Node[];
  readonly facts: RustPlanQueries;
  readonly native: RustNativeCallableInputPlan;
  readonly definitions: RustTypeDefinitions;
  readonly returnCarrierFor: (declaration: Node) => TargetTypeRef | undefined;
}): RustNativeCallableProducerPlan {
  const byDeclaration = new Map<Node, RustNativeCallableProducer>();
  const byIdentity = new Map<string, RustNativeCallableProducer>();
  for (const declaration of input.nodes) {
    if (input.ast.body(declaration) === undefined) continue;
    const result = input.facts.getFact(declaration, rustSourceCallableReturnFactKey);
    if (result === undefined) continue;
    const identity = sourceNodeIdentity(input.ast, declaration);
    const file = input.ast.getSourceFile(declaration);
    if (identity === undefined || file === undefined) continue;
    const fileName = input.ast.getFileName(file);
    const captures = input.facts.getFact(declaration, rustClosureCaptureFactKey);
    const operation = input.facts.getFact(declaration, rustTargetOperationFactKey);
    const carriers = [result.returnCarrier,
      ...input.ast.parameters(declaration).flatMap(parameter => {
        const carrier = input.facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier;
        return carrier === undefined ? [] : [carrier];
      }),
      ...[...captures?.captures ?? [], ...captures?.receiverFields ?? [], ...captures?.receivers ?? []].map(capture => capture.carrier),
      ...[...input.native.inputsFor(declaration), ...input.native.capturesFor(declaration)].flatMap(selected =>
        [selected.implementation, selected.protocol.trait]),
      ...(operation?.kind === "closure" ? [operation.resultCarrier] : []),
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
  const errorFor = (declaration: Node, channel: "invoke" | number): TargetTypeRef | undefined => {
    const producer = byDeclaration.get(declaration);
    return producer === undefined ? undefined : rustProducerErrorTargetType({
      identity: producer.identity, fileName: producer.fileName, channel, genericArguments: producer.environment,
    });
  };
  const noFuture: RustDeferredProducerChannel = Object.freeze({ awaiting: "infallible",
    errorCarrier: Object.freeze({ kind: "target-named", id: rustInfallibleTargetId }) });
  const deferredFor = (declaration: Node, ordinal: number): RustDeferredProducerChannel | undefined => {
    if (!byDeclaration.has(declaration) || !Number.isSafeInteger(ordinal) || ordinal < 0) return undefined;
    const selected = input.facts.getFact(declaration, rustDeferredProducerEffectsFactKey);
    return selected?.kind === "no-future" ? noFuture : selected?.channels[ordinal];
  };
  const resolving = new Set<string>();
  return Object.freeze({ producers: Object.freeze([...byDeclaration.values()]), errorFor,
    forDeclaration: (declaration: Node) => byDeclaration.get(declaration),
    forIdentity: (identity: string) => byIdentity.get(identity),
    deferredFor,
    deferredErrorFor: (declaration: Node, ordinal: number) => deferredFor(declaration, ordinal)?.errorCarrier,
    physicalFor(declaration: Node, carrier: TargetTypeRef): TargetTypeRef | undefined {
      const producer = byDeclaration.get(declaration);
      const signature = rustCallableProtocol(carrier);
      const error = errorFor(declaration, "invoke");
      if (producer === undefined || signature === undefined || error === undefined) return undefined;
      const operation = input.facts.getFact(declaration, rustTargetOperationFactKey);
      const sourceSignature = operation?.kind === "closure" ? rustCallableProtocol(operation.resultCarrier) : undefined;
      const asynchronous = input.facts.getFact(declaration, rustAsyncFunctionFactKey);
      const expectedParameters = sourceSignature?.parameters ?? input.ast.parameters(declaration).map(parameter =>
        input.facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier);
      const expectedResult = sourceSignature?.result ?? asynchronous?.futureCarrier ??
        input.facts.getFact(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
      if (expectedParameters.length !== signature.parameters.length ||
        !expectedParameters.every((parameter, index) => rustTargetTypeRefEquals(parameter, signature.parameters[index])) ||
        !rustTargetTypeRefEquals(expectedResult, signature.result)) return undefined;
      const key = `${producer.identity}:${closedMetadataKey(carrier)}`;
      if (resolving.has(key) || resolving.size >= 128) return undefined;
      resolving.add(key);
      let resultCarrier: TargetTypeRef | undefined;
      try { resultCarrier = input.returnCarrierFor(declaration); }
      finally { resolving.delete(key); }
      if (resultCarrier === undefined) return undefined;
      const completion = rustNativeCallableCompletion(asynchronous?.futureCarrier ?? resultCarrier, input.definitions);
      const output = completion === undefined ? resultCarrier : instantiateRustNativeCompletion(completion, future => {
        const selectedError = errorFor(declaration, future.ordinal);
        if (selectedError === undefined) return undefined;
        const output = asynchronous === undefined ? future.output : resultCarrier;
        return future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId
          ? { ...future.carrier, genericArguments: future.carrier.genericArguments!.map((argument, index) =>
            index === 2 ? { kind: "type" as const, type: selectedError }
              : index === 1 ? { kind: "type" as const, type: output } : argument) }
          : rustNativeCompletionFutureType({ identity: `${producer.identity}:future:${future.ordinal}`,
            output, error: selectedError, captures: producer.environment });
      }, input.definitions);
      if (output === undefined) return undefined;
      const arguments_: TargetTypeRef = { kind: "tuple", elements: signature.parameters };
      const result = rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([output, error]));
      return rustCallableInputProtocol(carrier) === undefined
        ? rustNamedTargetType("rust.runtime.Callable", "rt::Callable", rustTypeGenericArguments([arguments_, result]))
        : rustClosureTargetType([arguments_], result);
    },
  });
}
