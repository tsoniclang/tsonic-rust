import type { RustNativeCallableProtocol } from "../../../../target-model/records/native/native-protocols.js";
import type { RustGenerics, RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustLifetimeBinderToAst } from "../../types/carrier-syntax.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustNativeCallableMethodGenerics(
  protocol: RustNativeCallableProtocol,
  context: RustPlanContext,
): RustGenerics {
  const predicates: readonly RustWherePredicate[] = protocol.method.outlives.map(bound => {
    const type = rustTypeFromCarrierInContext(bound.carrier, context);
    if (type === undefined) failRustPlannerInvariant("An admitted callable method requires its renderable outlives carrier.");
    return { kind: "type", type, bounds: [{ kind: "lifetime", lifetime: rustLifetimeToAst(bound.lifetime) }] };
  });
  return {
    parameters: [...rustLifetimeBinderToAst(protocol.method.binder),
      ...protocol.signature.typeParameters.map(parameter => ({ kind: "type" as const,
        name: parameter.name, bounds: [],
      }))],
    wherePredicates: predicates,
  };
}
