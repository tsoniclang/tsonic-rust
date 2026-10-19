import type { Node } from "@tsonic/tsts";
import type { RustCallableGenericPlan } from "./generics.js";

import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { failRustPlannerInvariant } from "../../../invariants.js";

export function planRustRetainedGenerics(declaration: Node, source: RustCallableGenericPlan): RustCallableGenericPlan {
  const { context } = source;
  const selected = context.input.program.records.nativeGenerics.get(declaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted retained callable requires its native generic context.", declaration);
  const retained = selected.retention;
  if (retained === undefined) return source;
  const lifetime = rustLifetimeToAst(context.lifetimeSubstitutions?.get(rustLifetimeKey(retained.lifetime)) ?? retained.lifetime);
  const carriers = context.promiseBody === true ? retained.body : retained.source;
  const predicates = new Map<string, RustWherePredicate>();
  for (const carrier of carriers) {
    const type = rustTypeFromCarrierInContext(carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted retained callable requires its renderable native outlives bound.", declaration);
    const predicate: RustWherePredicate = { kind: "type", type, bounds: [{ kind: "lifetime", lifetime }] };
    predicates.set(closedMetadataKey(predicate), predicate);
  }
  const generics = source.finalizeGenerics();
  return { ...source, finalizeGenerics: () => rustGenericsWithAssociatedBounds(generics.parameters,
    [...generics.wherePredicates, ...predicates.values()]) };
}
