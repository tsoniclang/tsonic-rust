import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { instantiateRustNativeCompletion, rustNativeFutureOutputType } from "../../../target-model/types/callable-completions.js";
import { rustNativeCallableCompletion } from "../../../policy/types/callables/native-completion.js";
import { rustJsPromiseTargetType } from "../../../target-model/types/carriers/promises.js";
import { rustJsPromiseTargetId } from "../../../target-model/types/carriers/source-types.js";
import { rustNamedTargetType } from "../../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native/native-producers.js";
import { getRustGeneratorProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGeneratorStorageTargetType } from "../../../policy/types/callables/generators.js";
import { rustPlaceholderLifetime } from "../../../target-model/lifetimes/index.js";

export interface RustNativeOutwardResults {
  returnFor(declaration: Node): TargetTypeRef | undefined;
  invocationFor(declaration: Node): TargetTypeRef | undefined;
  bodyFor(declaration: Node): TargetTypeRef | undefined;
}

export function createRustNativeOutwardResults(input: {
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly producers: Pick<RustNativeCallableProducerPlan, "forDeclaration" | "errorFor" | "deferredFor">;
  readonly returnCarrierFor: (declaration: Node) => TargetTypeRef | undefined;
}): RustNativeOutwardResults {
  const resolving = new Set<Node>();
  const select = (declaration: Node, mode: "return" | "invocation" | "body"): TargetTypeRef | undefined => {
    const producer = input.producers.forDeclaration(declaration);
    if (producer === undefined || resolving.has(declaration) || resolving.size >= 128) return undefined;
    resolving.add(declaration);
    try {
      const source = input.records.sourceCallableReturn.get(declaration);
      if (source === undefined) return undefined;
      const physical = input.returnCarrierFor(declaration);
      if (physical === undefined) return undefined;
      const generator = input.records.generator.get(declaration);
      if (generator !== undefined) {
        const protocol = getRustGeneratorProtocol(physical);
        const error = input.producers.errorFor(declaration, "body");
        if (protocol?.kind !== generator.kind || error === undefined) return undefined;
        if (mode === "body") return rustNativeFutureOutputType({ identity: `${producer.identity}:body`,
          output: rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([protocol.returnType, error])),
          captures: producer.environment });
        const lifetime = generator.storage.kind === "lifetime" ? generator.storage.lifetime
          : generator.storage.kind === "receiver" ? rustPlaceholderLifetime : undefined;
        return rustGeneratorStorageTargetType(protocol, lifetime, error);
      }
      const asynchronous = input.records.asyncFunction.get(declaration);
      if (mode === "body" && asynchronous === undefined) return undefined;
      if (mode !== "return" && asynchronous !== undefined) {
        if (mode === "invocation" && asynchronous.kind === "js-promise") {
          const result = rustJsPromiseTargetType(physical);
          const operation = input.records.targetOperation.get(declaration);
          const conversion = operation?.kind === "closure" ? operation.invocationResult : undefined;
          if (conversion === undefined) return result;
          if (!rustTargetTypeRefEquals(conversion.sourceCarrier, asynchronous.futureCarrier)) return undefined;
          const completion = rustNativeCallableCompletion(conversion.targetCarrier, input.definitions);
          return completion === undefined ? undefined : instantiateRustNativeCompletion(completion,
            future => rustTargetTypeRefEquals(future.carrier, asynchronous.futureCarrier) ? result : undefined,
            input.definitions);
        }
        const error = input.producers.errorFor(declaration, mode === "body" ? "body" : 0);
        const effects = input.records.sourceCallEffects.get(declaration);
        if (error === undefined || effects === undefined) return undefined;
        const output = effects.awaiting === "fallible"
          ? rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([physical, error])) : physical;
        return rustNativeFutureOutputType({ identity: `${producer.identity}:return:0`, output, captures: producer.environment });
      }
      const completion = rustNativeCallableCompletion(physical, input.definitions);
      if (completion === undefined) return physical;
      return instantiateRustNativeCompletion(completion, future => {
        if (future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId) {
          return rustJsPromiseTargetType(future.output);
        }
        const channel = input.producers.deferredFor(declaration, future.ordinal);
        if (channel === undefined) return undefined;
        const output = channel.awaiting === "fallible"
          ? rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([future.output, channel.errorCarrier]))
          : future.output;
        return rustNativeFutureOutputType({ identity: `${producer.identity}:return:${future.ordinal}`, output,
          captures: producer.environment, ready: source.implementationCompletion !== undefined });
      }, input.definitions);
    } finally { resolving.delete(declaration); }
  };
  return Object.freeze({
    returnFor: (declaration: Node) => select(declaration, "return"),
    invocationFor: (declaration: Node) => select(declaration, "invocation"),
    bodyFor: (declaration: Node) => select(declaration, "body"),
  });
}
