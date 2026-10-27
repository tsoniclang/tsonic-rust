import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import type { RustNativeErrorSource } from "../../../target-model/types/native-error-joins.js";
import type { RustSourceCallEffectsFact } from "../../../target-model/records/object-methods.js";

import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../target-model/records/generic-callables.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native-producers.js";
import type { RustGenericCallableBindingContext } from "./generic-bindings.js";
import { createRustEffectsWorkBudget } from "../../errors/effects-work-budget.js";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";

export function analyzeRustGenericCallableErrors(
  input: Parameters<typeof selectRustGenericCallableErrors>[1],
): TargetStageResult<RustGenericCallableErrorIndex> {
  const budget = createRustEffectsWorkBudget();
  const selections = new Map<RustGenericCallablePhysicalDefinition, RustGenericCallableErrorSelection>();
  const failure = budget.run(() => {
    for (const definition of input.physical.definitions()) {
      budget.step();
      if (definition.members.length !== 0) budget.step(definition.members.length);
      const selection = selectRustGenericCallableErrors(definition, input);
      if (selection !== undefined) {
        for (const source of [...selection.invocation, ...selection.awaiting]) budget.metadata(source);
        selections.set(definition, selection);
      }
    }
  });
  return failure === undefined ? resolvedTargetStage(sealRustGenericCallableErrorIndex(selections)) : rejectedTargetStage([{ ...failure, category: "error", source: "tsonic-rust" }]);
}

export function selectRustGenericCallableErrors(
  definition: RustGenericCallablePhysicalDefinition,
  input: RustGenericCallableBindingContext & {
    readonly producers: RustNativeCallableProducerPlan;
    readonly effectsFor: (declaration: Node) => RustSourceCallEffectsFact | undefined;
  },
): RustGenericCallableErrorSelection | undefined {
  const invocation: RustNativeErrorSource<TargetTypeRef>[] = [];
  const awaiting: RustNativeErrorSource<TargetTypeRef>[] = [];
  const selections = new Map<RustGenericCallablePhysicalMember, RustGenericCallableMemberErrors>();
  for (const member of definition.members) {
    const declaration = member.implementation.declaration;
    const effects = input.effectsFor(declaration);
    const bindings = member.bindings;
    const producer = input.producers.forDeclaration(declaration);
    if (effects === undefined || bindings === undefined || producer === undefined) return undefined;
    const selected: { invocation: RustNativeErrorSource<TargetTypeRef> | undefined;
      awaiting: RustNativeErrorSource<TargetTypeRef> | undefined } = { invocation: undefined, awaiting: undefined };
    for (const channel of ["invocation", "awaiting"] as const) {
      if (effects[channel] !== "fallible") continue;
      const error = input.producers.errorFor(declaration, channel === "invocation" ? "invoke" : 0);
      if (error === undefined) return undefined;
      const sources = channel === "invocation" ? invocation : awaiting;
      const source = Object.freeze({ identity: `${definition.identity}:${member.variantName}:${producer.identity}:${channel}`,
        variant: `Error${sources.length}`,
        errorType: substituteRustTargetGenerics(error, bindings.types, bindings.lifetimes, bindings.consts) });
      sources.push(source);
      selected[channel] = source;
    }
    selections.set(member, Object.freeze({ effects, ...selected }));
  }
  return sealRustGenericCallableErrorSelection({ invocation: Object.freeze(invocation), awaiting: Object.freeze(awaiting),
    effects: Object.freeze({ invocation: invocation.length > 0 ? "fallible" : "infallible",
      awaiting: awaiting.length > 0 ? "fallible" : [...selections.values()].some(value => value.effects.awaiting !== "not-applicable")
        ? "infallible" : "not-applicable" }),
    members: selections,
  });
}

import type { RustGenericCallableErrorIndex, RustGenericCallableErrorSelection, RustGenericCallableMemberErrors } from "../../../target-model/records/generic-callable-errors.js";
import { sealRustGenericCallableErrorIndex, sealRustGenericCallableErrorSelection } from "../../program/records/generic-callable-errors.js";
