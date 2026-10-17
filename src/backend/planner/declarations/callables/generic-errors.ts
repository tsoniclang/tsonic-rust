import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "../../../../analysis/callables/generic-physical.js";
import type { RustSourceCallEffectsFact } from "../../../../target-model/records/object-methods.js";
import type { RustGenericCallableEffectsFact } from "../../../../target-model/records/generic-callable-effects.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../../types/render.js";
import type { RustNativeErrorSource } from "../../../../target-model/types/native-error-joins.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { planRustNativeErrorJoin, type RustNativeErrorJoinPlan, type RustNativeErrorJoinSelection,
  type RustNativeErrorJoinSource } from "../../types/native-error-joins.js";

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
): RustGenericCallableErrorPlan | undefined {
  const { program } = context.input;
  const selected = program.genericCallableErrors.forDefinition(definition);
  if (selected === undefined) return undefined;
  const selections = new Map<RustGenericCallablePhysicalMember, RustGenericCallableProducerErrors>();
  for (const member of definition.members) {
    const errors = selected.forMember(member);
    if (errors === undefined) return undefined;
    const rendered: { invocation: RustNativeErrorJoinSelection | undefined; awaiting: RustNativeErrorJoinSelection | undefined } = {
      invocation: undefined, awaiting: undefined,
    };
    for (const channel of ["invocation", "awaiting"] as const) {
      const source = errors[channel];
      if (source === undefined) continue;
      const errorType = rustTypeFromSelectedNativeCarrierInContext(source.nativeType, context);
      rendered[channel] = { identity: source.identity, variant: source.variant, errorType };
    }
    selections.set(member, Object.freeze({ effects: errors.effects, ...rendered }));
  }
  const invocationJoin = planRustGenericCallableErrorJoin(definition.ownerFileName, selected.invocation, context);
  const awaitingJoin = planRustGenericCallableErrorJoin(definition.ownerFileName, selected.awaiting, context);
  return invocationJoin === undefined || awaitingJoin === undefined ? undefined : Object.freeze({
    effects: selected.effects,
    invocation: invocationJoin, awaiting: awaitingJoin,
    forMember: (member: RustGenericCallablePhysicalMember) => selections.get(member),
  });
}

export function planRustGenericCallableErrorJoin(
  ownerFileName: string, sources: readonly (RustNativeErrorSource<TargetTypeRef> & { readonly nativeType: TargetTypeRef })[], context: RustPlanContext,
): RustNativeErrorJoinPlan | undefined {
  const rendered: RustNativeErrorJoinSource[] = [];
  for (const source of sources) {
    const errorType = rustTypeFromSelectedNativeCarrierInContext(source.nativeType, context);
    rendered.push({ identity: source.identity, variant: source.variant, errorType });
  }
  const arity = sources.length;
  const name = arity < 2 ? `NativeErrors${arity}` : context.input.errorRegions.nameFor(ownerFileName, arity);
  const moduleName = context.moduleNameByFileName.get(ownerFileName);
  if (name === undefined || moduleName === undefined) return undefined;
  const external = context.externalCrateNameByFileName.get(ownerFileName);
  return planRustNativeErrorJoin({ identity: `native-error-join:${ownerFileName}:${arity}`,
    name, referencePath: `${external !== undefined && external !== context.crateName ? external : "crate"}::${moduleName}::${name}`,
    visibility: "public", sources: rendered });
}
