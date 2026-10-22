import type { RustOperationPolicyContext } from "../../model/operation-context.js";
import type { RustCheckedCallSelectionInput } from "../../model/contracts.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { asNode } from "../../identities/selected-source.js";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustCallScopedElisionLifetime, rustLifetimeKey } from "../../../target-model/lifetimes/index.js";

export function selectRustRuntimeCallableGenerics(
  request: RustCheckedCallSelectionInput,
  carrier: TargetTypeRef,
  context: RustOperationPolicyContext,
): readonly RustTargetGenericArgument[] | undefined {
  const selected = request.source.sourceSelectedMethodTypeArguments ?? [];
  // Closures and higher-ranked function pointers (function values with lifetime parameters) carry the call binder.
  const binder = carrier.kind === "closure" || carrier.kind === "function-pointer" ? carrier.lifetimeBinder : undefined;
  if (binder === undefined) return selected.length === 0 ? [] : undefined;
  if (selected.length !== binder.parameters.length) return undefined;
  const call = asNode(request.source.call, context);
  const identity = call === undefined ? undefined : sourceNodeIdentity(context.ast, call);
  if (identity === undefined) return undefined;
  const result = selected.map((argument, index): RustTargetGenericArgument | undefined => {
    const bound = binder.parameters[index]!.lifetime;
    const parameters = context.currentSemantics.facts.typeSubjects(argument.typeParameter)
      .flatMap(subject => {
        const parameter = context.sourceLifetimes.parameterFor(asNode(subject, context));
        return parameter === undefined ? [] : [parameter];
      });
    // A function value's binder (analysis/callables/higher-ranked-function.ts) substitutes fresh bound lifetimes for the
    // declaration's lifetime parameters in order, so it is matched by position; a closure binder is matched by identity.
    if (parameters.length === 0 || parameters.some(parameter => parameter.kind !== "lifetime" ||
      carrier.kind !== "function-pointer" && rustLifetimeKey(parameter.lifetime) !== rustLifetimeKey(bound))) return undefined;
    const lifetime = argument.explicitTypeNode === undefined
      ? rustCallScopedElisionLifetime(identity, rustLifetimeKey(bound))
      : context.sourceLifetimes.resolve(argument.explicitTypeNode);
    return lifetime === undefined ? undefined : { kind: "lifetime", lifetime };
  });
  return result.some(argument => argument === undefined) ? undefined
    : result as readonly RustTargetGenericArgument[];
}
