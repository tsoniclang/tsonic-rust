import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import { isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustNativeCallableCompletion } from "../../../policy/types/callables/native-completion.js";
import { rustProducerErrorReference, type RustProducerErrorReference } from "../../../target-model/types/carriers/producer-errors.js";
import { rustInfallibleTargetId } from "../../../target-model/types/carriers/source-types.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { bindRustGenericArguments } from "../../../target-model/types/carriers/generic-argument-bindings.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustJsPromiseOutputTargetType } from "../../../target-model/types/carriers/promises.js";
import { rustJsValueTargetType } from "../../../target-model/types/carriers/js.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

import type { RustErrorEffectsFact } from "../../../target-model/records/error-effects.js";

import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native-producers.js";

export interface RustProducerErrorContext {
  readonly producers: RustNativeCallableProducerPlan;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
}

export type RustProducerErrorSelection =
  | { readonly kind: "carrier"; readonly carrier: TargetTypeRef }
  | { readonly kind: "region"; readonly declaration: Node; readonly effects: RustErrorEffectsFact };

export function selectRustProducerError(
  reference: RustProducerErrorReference,
  input: RustProducerErrorContext,
): RustProducerErrorSelection | undefined {
  if (!isClosedMetadata(reference) || rustProducerErrorReference({ kind: "target-specific", target: "rust",
    name: "producer-error", value: reference }) === undefined) return undefined;
  const producer = input.producers.forIdentity(reference.identity);
  if (producer === undefined || producer.fileName !== reference.fileName ||
    producer.environment.length !== reference.genericArguments.length) return undefined;
  const bindings = bindRustGenericArguments(producer.environment, reference.genericArguments);
  if (bindings === undefined) return undefined;
  const { types, lifetimes, consts } = bindings;
  const asynchronous = input.records.asyncFunction.get(producer.declaration);
  const generator = input.records.generator.get(producer.declaration);
  if (reference.channel === "body" && asynchronous === undefined && generator === undefined) return undefined;
  const suspended = asynchronous !== undefined || generator !== undefined;
  if (reference.channel === "invoke" && suspended) return Object.freeze({ kind: "carrier",
    carrier: Object.freeze({ kind: "target-named", id: rustInfallibleTargetId }) });
  const closure = input.records.targetOperation.get(producer.declaration);
  if (reference.channel === "invoke" && closure?.kind === "closure" &&
    rustTargetTypeRefEquals(rustCallableProtocol(closure.resultCarrier)?.error, rustJsValueTargetType()))
    return Object.freeze({ kind: "carrier", carrier: rustJsValueTargetType() });
  if (reference.channel !== "invoke" && reference.channel !== "body") {
    const result = asynchronous?.futureCarrier ??
      input.records.sourceCallableReturn.get(producer.declaration)?.returnCarrier;
    const completion = result === undefined ? undefined : rustNativeCallableCompletion(result, input.definitions);
    const future = completion?.futures[reference.channel];
    if (future === undefined) return undefined;
    if (rustJsPromiseOutputTargetType(future.carrier) !== undefined)
      return Object.freeze({ kind: "carrier", carrier: rustJsValueTargetType() });
    if (asynchronous === undefined) {
      const error = input.producers.deferredErrorFor(producer.declaration, reference.channel);
      return error === undefined ? undefined : Object.freeze({ kind: "carrier",
        carrier: substituteRustTargetGenerics(error, types, lifetimes, consts) });
    }
  }
  const effects = input.records.errorEffects.get(producer.declaration);
  return effects === undefined ? undefined : Object.freeze({ kind: "region", declaration: producer.declaration,
    effects: Object.freeze({ localErrors: effects.localErrors,
      nativeErrors: Object.freeze(effects.nativeErrors.map(source => Object.freeze({ ...source,
        errorType: substituteRustTargetGenerics(source.errorType, types, lifetimes, consts) }))),
    }),
  });
}
