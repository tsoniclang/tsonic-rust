import type { RustRetainedEnvironmentSelection } from "../../target-model/records/retained-environments.js";
import { rustHasOpenOwnedStorage, rustHasOpenCallableEnvironment, closeRustRetainedCallableCarrier } from "../../policy/ownership/retained-storage.js";
import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../../policy/model/context.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustCallScopedElisionLifetime, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { selectRustSuspendedStorageLifetime } from "../../policy/ownership/suspended-storage.js";
import { rustEnclosingStorageContract } from "./storage-contracts.js";

export function rustRetainedValueLifetime(
  declaration: Node, captures: readonly TargetTypeRef[],
  walk: { readonly context: Pick<RustSourcePolicyContext, "ast" | "sourceLifetimes" | "records" | "retainedEnvironments"> },
): RustLifetimeRef | undefined {
  const { context } = walk;
  if (!captures.some(rustHasOpenOwnedStorage)) return selectRustSuspendedStorageLifetime(captures,
    rustEnclosingStorageContract(declaration, context.ast, context.sourceLifetimes));
  const owner = sourceEnclosingCallable(context.ast.parent(declaration), context.ast);
  const selected = owner === undefined ? { kind: "none" as const } : rustRetainedEnvironment(owner,
    context.ast.parameters(owner).map(parameter => context.records.sourceParameterAbi.get(parameter)?.parameterCarrier), context);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "selected") return selected.environment.lifetime;
  const identity = sourceNodeIdentity(context.ast, declaration);
  return identity === undefined ? undefined : rustCallScopedElisionLifetime(identity, "owned-environment");
}

export function rustSuspendedCapturedParameters(declaration: Node, context: RustSourcePolicyContext): readonly Node[] | undefined {
  return context.retainedEnvironments.suspendedParametersFor(declaration);
}

export function rustRetainedEnvironment(
  declaration: Node,
  parameterCarriers: readonly (TargetTypeRef | undefined)[],
  context: Pick<RustSourcePolicyContext, "ast" | "retainedEnvironments">,
): RustRetainedEnvironmentSelection {
  const parameters = context.ast.parameters(declaration);
  if (parameters.length !== parameterCarriers.length || parameters.some(parameter => parameter === undefined) ||
    parameterCarriers.some(carrier => carrier === undefined)) return { kind: "unresolved",
      reason: "A retained native environment requires exact declaration-owned input carriers." };
  const openParameters = new Set(parameters.filter((parameter, index) => {
    const carrier = parameterCarriers[index];
    return parameter !== undefined && carrier !== undefined && rustHasOpenOwnedStorage(carrier);
  }));
  const none = Object.freeze({ kind: "none" as const });
  if (openParameters.size === 0) return none;
  const selected = context.retainedEnvironments.environmentFor(declaration);
  return selected.kind === "selected" && !selected.environment.parameters.some(parameter => openParameters.has(parameter))
    ? none : selected;
}

export function closeRustRetainedParameter(
  parameter: Node, carrier: TargetTypeRef, context: RustSourcePolicyContext,
): TargetTypeRef | undefined {
  if (!rustHasOpenCallableEnvironment(carrier)) return carrier;
  if (!context.ast.is.IsParameterDeclaration(parameter)) return undefined;
  const declaration = context.ast.parent(parameter);
  if (declaration === undefined || !context.ast.parameters(declaration).includes(parameter)) return undefined;
  const selected = context.retainedEnvironments.environmentFor(declaration);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "none" || !selected.environment.parameters.includes(parameter)) return carrier;
  return closeRustRetainedCallableCarrier(carrier, selected.environment.lifetime);
}
