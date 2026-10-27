import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../../target-model/records/callables/generic-callables.js";
import type { RustSourceCallEffectsFact } from "../../../../target-model/records/objects/object-methods.js";
import type { RustGenericCallableEffectsFact } from "../../../../target-model/records/callables/generic-callable-effects.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustNativeErrorSource } from "../../../../target-model/types/native-error-joins.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { planRustNativeErrorJoin, type RustNativeErrorJoinPlan, type RustNativeErrorJoinSelection,
  type RustNativeErrorJoinSource } from "../../types/native-error-joins.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export interface RustGenericCallableProducerErrors {
  readonly effects: RustSourceCallEffectsFact;
  readonly invocation: RustNativeErrorJoinSelection | undefined;
  readonly awaiting: RustNativeErrorJoinSelection | undefined;
}

export interface RustGenericCallableErrorPlan {
  readonly effects: RustGenericCallableEffectsFact;
  readonly invocation: RustNativeErrorJoinPlan;
  readonly awaiting: RustNativeErrorJoinPlan;
  forMember(member: RustGenericCallablePhysicalMember): RustGenericCallableProducerErrors | undefined;
}

export function planRustGenericCallableErrors(
  definition: RustGenericCallablePhysicalDefinition,
  context: RustPlanContext,
): RustGenericCallableErrorPlan {
  const selected = context.input.program.records.genericCallableErrors.get(definition);
  if (selected === undefined) failRustPlannerInvariant("An admitted generic callable requires its sealed error emission record.");
  const selections = new Map<RustGenericCallablePhysicalMember, RustGenericCallableProducerErrors>();
  for (const member of definition.members) {
    const errors = selected.members.get(member);
    if (errors === undefined) failRustPlannerInvariant("An admitted generic callable member requires its native error channels.", member.implementation.declaration);
    const rendered: { invocation: RustNativeErrorJoinSelection | undefined; awaiting: RustNativeErrorJoinSelection | undefined } = {
      invocation: undefined, awaiting: undefined,
    };
    for (const channel of ["invocation", "awaiting"] as const) {
      const source = errors[channel];
      if (source === undefined) continue;
      const errorType = rustTypeFromCarrierInContext(source.errorType, context);
      if (errorType === undefined) failRustPlannerInvariant("An admitted generic callable error requires its renderable native carrier.", member.implementation.declaration);
      rendered[channel] = { ...source, errorType };
    }
    selections.set(member, Object.freeze({ effects: errors.effects, ...rendered }));
  }
  const invocationJoin = planRustGenericCallableErrorJoin(definition.ownerFileName, selected.invocation,
    selected.effects.invocation === "fallible" ? "result" : "value", context);
  const awaitingJoin = planRustGenericCallableErrorJoin(definition.ownerFileName, selected.awaiting,
    selected.effects.awaiting === "fallible" ? "result" : "value", context);
  return Object.freeze({
    effects: selected.effects,
    invocation: invocationJoin, awaiting: awaitingJoin,
    forMember: (member: RustGenericCallablePhysicalMember) => selections.get(member),
  });
}

export function planRustGenericCallableErrorJoin(
  ownerFileName: string, sources: readonly RustNativeErrorSource<TargetTypeRef>[],
  resultShape: "value" | "result", context: RustPlanContext,
): RustNativeErrorJoinPlan {
  const rendered: RustNativeErrorJoinSource[] = [];
  for (const source of sources) {
    const errorType = rustTypeFromCarrierInContext(source.errorType, context);
    if (errorType === undefined) failRustPlannerInvariant("An admitted generic callable error join requires its renderable native source carrier.");
    rendered.push({ ...source, errorType });
  }
  const arity = sources.length;
  const name = context.input.program.records.nativeErrorJoinName.get(ownerFileName, arity);
  const moduleName = context.moduleNameByFileName.get(ownerFileName);
  if (name === undefined || moduleName === undefined) failRustPlannerInvariant("An admitted generic callable error join requires its native declaration name and source module.");
  const external = context.externalCrateNameByFileName.get(ownerFileName);
  return planRustNativeErrorJoin({ identity: `native-error-join:${ownerFileName}:${arity}`,
    name, referencePath: `${external !== undefined && external !== context.crateName ? external : "crate"}::${moduleName}::${name}`,
    visibility: "public", resultShape, sources: rendered }) ?? failRustPlannerInvariant("An admitted generic callable error join requires its selected native join plan.");
}
