import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { inferRustTargetGenericBindings, rustTargetGenericReferences, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustLifetimeKey, rustPlaceholderLifetime } from "../../../target-model/lifetimes/index.js";

import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";

export function rustProjectViewMatches(
  view: Pick<RustProjectStructuralView, "sourceCarrier" | "targetCarrier">,
  sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef,
): boolean {
  return rustProjectViewBindings(view, sourceCarrier, targetCarrier) !== undefined;
}

export function rustProjectViewBindings(
  view: Pick<RustProjectStructuralView, "sourceCarrier" | "targetCarrier">,
  sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef,
): RustTargetGenericBindings | undefined {
  const parameters = rustTargetGenericReferences(view.sourceCarrier);
  const bindings = inferRustTargetGenericBindings(view.sourceCarrier, sourceCarrier, {
    typeIdentities: new Set(parameters.typeIdentities), lifetimeIdentities: new Set(parameters.lifetimeIdentities),
    constIdentities: new Set(parameters.constIdentities),
  });
  return bindings !== undefined && bindings.types.size === parameters.typeIdentities.length &&
    bindings.lifetimes.size === parameters.lifetimeIdentities.length && bindings.consts.size === parameters.constIdentities.length &&
    rustTargetTypeRefEquals(substituteRustTargetGenerics(view.sourceCarrier, bindings.types, bindings.lifetimes, bindings.consts), sourceCarrier) &&
    rustProjectViewTargetMatches(substituteRustTargetGenerics(view.targetCarrier, bindings.types, bindings.lifetimes, bindings.consts), targetCarrier)
    ? bindings : undefined;
}

// A view's structural target keeps the placeholder lifetime of its declared callable members; each use selects that
// lifetime (for example a returned view's retained environment), so the placeholder matches the use's own lifetime.
function rustProjectViewTargetMatches(viewTarget: TargetTypeRef, targetCarrier: TargetTypeRef): boolean {
  return rustTargetTypeRefEquals(viewTarget, targetCarrier) || inferRustTargetGenericBindings(viewTarget, targetCarrier, {
    typeIdentities: new Set(), lifetimeIdentities: new Set([rustLifetimeKey(rustPlaceholderLifetime)]), constIdentities: new Set(),
  }) !== undefined;
}

import type { RustProjectStructuralView } from "../../../target-model/records/project-structural-views.js";
