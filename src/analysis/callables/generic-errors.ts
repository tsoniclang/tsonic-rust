import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import type { RustSourceCallEffectsFact } from "../facts/object-methods.js";
import type { RustGenericCallableEffectsFact } from "../facts/generic-callable-effects.js";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallablePhysicalMember } from "./generic-physical.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import { rustGenericCallableMemberBindings, type RustGenericCallableBindingContext } from "./generic-bindings.js";

export interface RustGenericCallableMemberErrors {
  readonly effects: RustSourceCallEffectsFact;
  readonly invocation: RustNativeErrorSource<TargetTypeRef> | undefined;
  readonly awaiting: RustNativeErrorSource<TargetTypeRef> | undefined;
}

export interface RustGenericCallableErrorSelection {
  readonly effects: RustGenericCallableEffectsFact;
  readonly invocation: readonly RustNativeErrorSource<TargetTypeRef>[];
  readonly awaiting: readonly RustNativeErrorSource<TargetTypeRef>[];
  forMember(member: RustGenericCallablePhysicalMember): RustGenericCallableMemberErrors | undefined;
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
    const bindings = rustGenericCallableMemberBindings(definition, member, input);
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
  return Object.freeze({ invocation: Object.freeze(invocation), awaiting: Object.freeze(awaiting),
    effects: Object.freeze({ invocation: invocation.length > 0 ? "fallible" : "infallible",
      awaiting: awaiting.length > 0 ? "fallible" : [...selections.values()].some(value => value.effects.awaiting !== "not-applicable")
        ? "infallible" : "not-applicable" }),
    forMember: (member: RustGenericCallablePhysicalMember) => selections.get(member),
  });
}
