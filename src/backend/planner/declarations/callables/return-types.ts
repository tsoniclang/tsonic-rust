import type { Node } from "@tsonic/tsts";
import type { RustAsyncFunctionFact, RustGeneratorFact } from "../../../../analysis/facts/keys.js";
import { rustSourceCallableReturnFactKey } from "../../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustType } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustJsPromiseTargetTypeWithLifetime } from "../../../../target-model/types/carriers/js.js";
import { instantiateRustNativeCompletion, rustNativeCallableCompletion, rustNativeFutureOutputType }
  from "../../../../target-model/types/callable-completions.js";
import { rustJsPromiseTargetId } from "../../../../target-model/types/carriers/source-types.js";
import { rustNamedTargetType } from "../../../../target-model/types/carriers/native.js";
import { rustTypeGenericArguments } from "../../../../target-model/types/generic-arguments.js";

export function resolveRustJsPromiseReturnType(
  declaration: Node, asynchronous: Extract<RustAsyncFunctionFact, { readonly kind: "js-promise" }>, context: RustPlanContext,
): RustType | undefined {
  const lifetime = asynchronous.futureCarrier.kind === "target-named" ? asynchronous.futureCarrier.genericArguments?.[0] : undefined;
  const output = context.input.program.callableValues.nativeStorage.returnFor(declaration);
  const error = context.input.program.callableValues.nativeProducers.errorFor(declaration, 0);
  return lifetime?.kind !== "lifetime" || output.kind === "unresolved" || error === undefined ? undefined
    : rustReturnTypeFromCarrierInContext(rustJsPromiseTargetTypeWithLifetime(output.carrier, lifetime.lifetime, error), context);
}

export function resolveRustCallableOutwardReturnType(
  declaration: Node, carrier: TargetTypeRef | undefined, context: RustPlanContext,
): RustType | undefined {
  if (carrier === undefined) return undefined;
  const { callableValues, facts, typeDefinitions } = context.input.program;
  const physical = callableValues.nativeStorage.returnFor(declaration);
  if (physical.kind === "unresolved") return undefined;
  const completion = rustNativeCallableCompletion(physical.carrier, typeDefinitions);
  if (completion === undefined) return rustReturnTypeFromCarrierInContext(physical.carrier, context);
  const producer = callableValues.nativeProducers.forDeclaration(declaration);
  const sourceReturn = facts.getFact(declaration, rustSourceCallableReturnFactKey);
  if (producer === undefined || sourceReturn === undefined) return undefined;
  const selected = instantiateRustNativeCompletion(completion, future => {
    const channel = callableValues.nativeProducers.deferredFor(declaration, future.ordinal);
    if (channel === undefined) return undefined;
    const error = channel.errorCarrier;
    if (future.carrier.kind === "target-named" && future.carrier.id === rustJsPromiseTargetId) {
      const lifetime = future.carrier.genericArguments?.[0];
      return lifetime?.kind !== "lifetime" ? undefined
        : rustJsPromiseTargetTypeWithLifetime(future.output, lifetime.lifetime, error);
    }
    const output = channel.awaiting === "fallible"
      ? rustNamedTargetType("rust.core.Result", "Result", rustTypeGenericArguments([future.output, error])) : future.output;
    return rustNativeFutureOutputType({ identity: `${producer.identity}:return:${future.ordinal}`, output,
      captures: producer.environment, ready: sourceReturn.implementationCompletion !== undefined });
  }, typeDefinitions);
  return selected === undefined ? undefined : rustReturnTypeFromCarrierInContext(selected, context);
}

export function resolveRustCallableBodyReturnType(
  outwardReturnType: RustType | undefined,
  generator: RustGeneratorFact | undefined,
  context: RustPlanContext,
): RustType | undefined {
  if (generator === undefined) {
    return outwardReturnType ?? { kind: "unit" };
  }
  return rustTypeFromCarrierInContext(generator.returnType, context);
}
