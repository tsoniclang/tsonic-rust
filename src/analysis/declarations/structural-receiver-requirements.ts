import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { inferRustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences, rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustLifetimeKey, rustPlaceholderLifetime } from "../../target-model/lifetimes/index.js";

// A template's callable members carry their own storage lifetimes (or a declared placeholder) where a receiver carries
// each use's lifetime; those lifetimes bind with the requested type parameters, and the instantiated template must equal
// the receiver exactly. Only the type bindings are returned.
export function bindRustStructuralReceiverParameters(
  template: TargetTypeRef,
  receiver: TargetTypeRef,
  parameters: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  if (rustStructuralObjectCarrierValue(template) === undefined ||
    rustStructuralObjectCarrierValue(receiver) === undefined) return undefined;
  const lifetimes = new Set([...rustTargetGenericReferences(template).lifetimeIdentities, rustLifetimeKey(rustPlaceholderLifetime)]);
  const bindings = inferRustTargetGenericBindings(template, receiver, { typeIdentities: parameters,
    lifetimeIdentities: lifetimes, constIdentities: new Set() });
  return bindings === undefined || !rustTargetTypeRefEquals(
    substituteRustTargetGenerics(template, bindings.types, bindings.lifetimes), receiver) ? undefined : bindings.types;
}

// One structural storage definition serves every declaration with the same shape, and its canonical carrier names the
// parameters of whichever declaration it was planned from. An interface member's captured parameters bind against the
// definition's carriers that name all of them (the declaring interface's own open carrier); every such binding must agree.
export function bindRustStructuralInterfaceParameters(
  carriers: readonly TargetTypeRef[],
  receiver: TargetTypeRef,
  parameters: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const declared = carriers.filter(carrier => {
    const identities = new Set(rustTargetTypeParameterIdentities(carrier));
    return [...parameters].every(parameter => identities.has(parameter));
  });
  const bound = declared.flatMap(carrier => {
    const bindings = bindRustStructuralReceiverParameters(carrier, receiver, parameters);
    return bindings === undefined ? [] : [bindings];
  });
  const first = bound[0];
  return first !== undefined && bound.every(bindings => bindings.size === first.size &&
    [...bindings].every(([identity, carrier]) => {
      const selected = first.get(identity);
      return selected !== undefined && rustTargetTypeRefEquals(selected, carrier);
    })) ? first : undefined;
}
