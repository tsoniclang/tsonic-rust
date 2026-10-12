import type { Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import { rustTargetGenericArgumentEquals } from "../../target-model/types/equality.js";
import { rustProducerErrorReference, type RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { rustInfallibleTargetId } from "../../target-model/types/carriers/source-types.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import type { RustTargetConstArgument, RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustErrorEffectsFactKey, type RustErrorEffectsFact } from "../facts/error-effects.js";
import { rustAsyncFunctionFactKey, rustGeneratorFactKey, rustSourceCallableReturnFactKey } from "../facts/keys.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";

export interface RustProducerErrorContext {
  readonly producers: RustNativeCallableProducerPlan;
  readonly facts: RustPlanQueries;
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
  const types = new Map<string, TargetTypeRef>();
  const lifetimes = new Map<string, RustLifetimeRef>();
  const consts = new Map<string, RustTargetConstArgument>();
  const argumentsByIdentity = new Map<string, RustTargetGenericArgument>();
  for (const [index, parameter] of producer.environment.entries()) {
    const argument = reference.genericArguments[index]!;
    let identity: string;
    if (parameter.kind === "type" && parameter.type.kind === "type-parameter" && argument.kind === "type") {
      identity = `type:${parameter.type.identity}`;
      types.set(parameter.type.identity, argument.type);
    } else if (parameter.kind === "lifetime" && argument.kind === "lifetime") {
      identity = `lifetime:${rustLifetimeKey(parameter.lifetime)}`;
      lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
    } else if (parameter.kind === "const" && parameter.value.kind === "parameter" && argument.kind === "const") {
      identity = `const:${parameter.value.identity}`;
      consts.set(parameter.value.identity, argument.value);
    } else return undefined;
    const previous = argumentsByIdentity.get(identity);
    if (previous !== undefined && !rustTargetGenericArgumentEquals(previous, argument)) return undefined;
    argumentsByIdentity.set(identity, argument);
  }
  const asynchronous = input.facts.getFact(producer.declaration, rustAsyncFunctionFactKey);
  const suspended = asynchronous !== undefined || input.facts.getFact(producer.declaration, rustGeneratorFactKey) !== undefined;
  if (reference.channel === "invoke" && suspended) return Object.freeze({ kind: "carrier",
    carrier: Object.freeze({ kind: "target-named", id: rustInfallibleTargetId }) });
  if (reference.channel !== "invoke") {
    const result = asynchronous?.futureCarrier ??
      input.facts.getFact(producer.declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
    const completion = result === undefined ? undefined : rustNativeCallableCompletion(result, input.definitions);
    if (completion?.futures[reference.channel] === undefined) return undefined;
    if (asynchronous === undefined) {
      const error = input.producers.deferredErrorFor(producer.declaration, reference.channel);
      return error === undefined ? undefined : Object.freeze({ kind: "carrier",
        carrier: substituteRustTargetGenerics(error, types, lifetimes, consts) });
    }
  }
  const effects = input.facts.getFact(producer.declaration, rustErrorEffectsFactKey);
  return effects === undefined ? undefined : Object.freeze({ kind: "region", declaration: producer.declaration,
    effects: Object.freeze({ localErrors: effects.localErrors,
      nativeErrors: Object.freeze(effects.nativeErrors.map(source => Object.freeze({ ...source,
        errorType: substituteRustTargetGenerics(source.errorType, types, lifetimes, consts) }))),
    }),
  });
}
