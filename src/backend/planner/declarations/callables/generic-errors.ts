import type { RustGenericCallableDefinition, RustGenericCallableImplementation } from "../../../../analysis/callables/generic-values.js";
import { rustSourceCallEffectsFactKey } from "../../../../analysis/facts/keys.js";
import type { RustSourceCallEffectsFact } from "../../../../analysis/facts/object-methods.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { substituteRustTargetTypeParameters } from "../../../../target-model/types/carriers/substitution.js";
import { planRustNativeErrorJoin, type RustNativeErrorJoinPlan, type RustNativeErrorJoinSelection,
  type RustNativeErrorJoinSource } from "../../types/native-error-joins.js";
import { rustGenericCallableImplementationSubstitutions } from "./generic-signatures.js";

export interface RustGenericCallableProducerErrors {
  readonly effects: RustSourceCallEffectsFact;
  readonly invocation: RustNativeErrorJoinSelection | undefined;
  readonly awaiting: RustNativeErrorJoinSelection | undefined;
}

export interface RustGenericCallableErrorPlan {
  readonly invocation: RustNativeErrorJoinPlan;
  readonly awaiting: RustNativeErrorJoinPlan;
  forImplementation(implementation: RustGenericCallableImplementation): RustGenericCallableProducerErrors | undefined;
}

export function planRustGenericCallableErrors(
  definition: RustGenericCallableDefinition,
  context: RustPlanContext,
): RustGenericCallableErrorPlan | undefined {
  const invocation: RustNativeErrorJoinSource[] = [];
  const awaiting: RustNativeErrorJoinSource[] = [];
  const selections = new Map<RustGenericCallableImplementation, RustGenericCallableProducerErrors>();
  for (const implementation of definition.implementations) {
    const effects = context.input.program.facts.getFact(implementation.declaration, rustSourceCallEffectsFactKey);
    const substitutions = rustGenericCallableImplementationSubstitutions(definition, implementation, context);
    const producer = context.input.program.callableValues.nativeProducers.forDeclaration(implementation.declaration);
    if (effects === undefined || substitutions === undefined || producer === undefined) return undefined;
    const selected: { invocation: RustNativeErrorJoinSelection | undefined; awaiting: RustNativeErrorJoinSelection | undefined } = {
      invocation: undefined, awaiting: undefined,
    };
    for (const channel of ["invocation", "awaiting"] as const) {
      if (effects[channel] !== "fallible") continue;
      const error = context.input.program.callableValues.nativeProducers.errorFor(implementation.declaration,
        channel === "invocation" ? "invoke" : 0);
      const errorType = error === undefined ? undefined : rustTypeFromCarrierInContext(
        substituteRustTargetTypeParameters(error, substitutions), context);
      if (errorType === undefined) return undefined;
      const sources = channel === "invocation" ? invocation : awaiting;
      const source = Object.freeze({ identity: `${producer.identity}:${channel}`, variant: `Error${sources.length}`, errorType });
      sources.push(source);
      selected[channel] = source;
    }
    selections.set(implementation, Object.freeze({ effects, ...selected }));
  }
  const join = (sources: readonly RustNativeErrorJoinSource[]): RustNativeErrorJoinPlan | undefined => {
    const arity = sources.length;
    const name = arity < 2 ? `NativeErrors${arity}` : context.input.errorRegions.nameFor(definition.ownerFileName, arity);
    const moduleName = context.moduleNameByFileName.get(definition.ownerFileName);
    if (name === undefined || moduleName === undefined) return undefined;
    const external = context.externalCrateNameByFileName.get(definition.ownerFileName);
    return planRustNativeErrorJoin({ identity: `native-error-join:${definition.ownerFileName}:${arity}`,
      name, referencePath: `${external !== undefined && external !== context.crateName ? external : "crate"}::${moduleName}::${name}`,
      visibility: "public", sources });
  };
  const invocationJoin = join(invocation);
  const awaitingJoin = join(awaiting);
  return invocationJoin === undefined || awaitingJoin === undefined ? undefined : Object.freeze({
    invocation: invocationJoin, awaiting: awaitingJoin,
    forImplementation: (implementation: RustGenericCallableImplementation) => selections.get(implementation),
  });
}
