import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { instantiateRustNativeCompletion, rustNativeCallableCompletion, rustNativeFutureOutputType }
  from "../../target-model/types/callable-completions.js";
import { rustJsPromiseTargetTypeWithLifetime } from "../../target-model/types/carriers/js.js";
import { rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustNamedTargetType } from "../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";




import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustErrorEffectsAreFallible } from "../errors/error-effects.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";

export interface RustNativeOutwardResults {
  returnFor(declaration: Node): TargetTypeRef | undefined;
  invocationFor(declaration: Node): TargetTypeRef | undefined;
}

export function createRustNativeOutwardResults(input: {
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly producers: Pick<RustNativeCallableProducerPlan, "forDeclaration" | "errorFor" | "deferredFor">;
  readonly returnCarrierFor: (declaration: Node) => TargetTypeRef | undefined;
}): RustNativeOutwardResults {
  const resolving = new Set<Node>();
  const select = (declaration: Node, invocation: boolean): TargetTypeRef | undefined => {
    const producer = input.producers.forDeclaration(declaration);
    if (producer === undefined || resolving.has(declaration) || resolving.size >= 128) return undefined;
    resolving.add(declaration);
    try {
      const source = input.records.sourceCallableReturn.get(declaration);
      if (source === undefined) return undefined;
      const physical = input.returnCarrierFor(declaration);
      if (physical === undefined) return undefined;
      const asynchronous = input.records.asyncFunction.get(declaration);
      if (invocation && asynchronous !== undefined) {
        const error = input.producers.errorFor(declaration, 0);
        if (error === undefined) return undefined;
        if (asynchronous.kind === "js-promise") {
          const lifetime = asynchronous.futureCarrier.kind === "target-named"
            ? asynchronous.futureCarrier.genericArguments?.[0] : undefined;
          if (lifetime?.kind !== "lifetime") return undefined;
          const result = rustJsPromiseTargetTypeWithLifetime(physical, lifetime.lifetime, error);
          const operation = input.records.targetOperation.get(declaration);
          const conversion = operation?.kind === "closure" ? operation.invocationResult : undefined;
          if (conversion === undefined) return result;
          if (!rustTargetTypeRefEquals(conversion.sourceCarrier, asynchronous.futureCarrier)) return undefined;
          const completion = rustNativeCallableCompletion(conversion.targetCarrier, input.definitions);
          return completion === undefined ? undefined : instantiateRustNativeCompletion(completion,
            future => rustTargetTypeRefEquals(future.carrier, asynchronous.futureCarrier) ? result : undefined,
            input.definitions);
        }
        const effects = input.records.errorEffects.get(declaration);
        if (effects === undefined) return undefined;
        const output = rustErrorEffectsAreFallible(effects)
          ? rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([physical, error])) : physical;
        return rustNativeFutureOutputType({ identity: `${producer.identity}:return:0`, output, captures: producer.environment });
      }
      const completion = rustNativeCallableCompletion(physical, input.definitions);
      if (completion === undefined) return physical;
      return instantiateRustNativeCompletion(completion, future => {
        if (future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId) {
          const lifetime = future.carrier.genericArguments?.[0];
          const error = input.producers.errorFor(declaration, future.ordinal);
          return lifetime?.kind !== "lifetime" || error === undefined ? undefined
            : rustJsPromiseTargetTypeWithLifetime(future.output, lifetime.lifetime, error);
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
    returnFor: (declaration: Node) => select(declaration, false),
    invocationFor: (declaration: Node) => select(declaration, true),
  });
}
