import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { inferRustTargetGenericBindings, rustTargetGenericReferences, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

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
    rustTargetTypeRefEquals(substituteRustTargetGenerics(view.targetCarrier, bindings.types, bindings.lifetimes, bindings.consts), targetCarrier)
    ? bindings : undefined;
}

import type { RustProjectStructuralView } from "../../../target-model/records/project-structural-views.js";
