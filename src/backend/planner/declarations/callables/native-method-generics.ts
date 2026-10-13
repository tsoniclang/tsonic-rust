import type { RustNativeCallableProtocol } from "../../../../analysis/callables/native-protocols.js";
import { rustTargetTypeChildren } from "../../../../target-model/types/carriers/children.js";
import { rustTargetGenericReferences } from "../../../../target-model/types/carriers/generic-references.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustLifetimeKey } from "../../../../target-model/lifetimes/index.js";
import type { RustGenerics, RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustLifetimeBinderToAst, rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";

export function planRustNativeCallableMethodGenerics(
  protocol: RustNativeCallableProtocol,
  context: RustPlanContext,
): RustGenerics | undefined {
  const lifetimes = new Set(protocol.method.binder.parameters.map(parameter => rustLifetimeKey(parameter.lifetime)));
  const predicates = new Map<string, RustWherePredicate>();
  const visited = new Set<TargetTypeRef>();
  const visit = (type: TargetTypeRef): boolean => {
    if (visited.has(type)) return true;
    visited.add(type);
    if (type.kind === "reference" && type.lifetime !== undefined && lifetimes.has(rustLifetimeKey(type.lifetime))) {
      const references = rustTargetGenericReferences(type.referent);
      if (references.typeIdentities.length > 0 || references.lifetimes.length > 0) {
        const referent = rustTypeFromCarrierInContext(type.referent, context);
        if (referent === undefined) return false;
        predicates.set(closedMetadataKey([type.referent, type.lifetime]), {
          kind: "type", type: referent, bounds: [{ kind: "lifetime", lifetime: rustLifetimeToAst(type.lifetime) }],
        });
      }
    }
    return rustTargetTypeChildren(type).every(visit);
  };
  if (!protocol.method.parameters.every(visit)) return undefined;
  return {
    parameters: [...rustLifetimeBinderToAst(protocol.method.binder),
      ...protocol.signature.typeParameters.map(parameter => ({ kind: "type" as const,
        name: parameter.name, bounds: [],
      }))],
    wherePredicates: [...predicates.values()],
  };
}
