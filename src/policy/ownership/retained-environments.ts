import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../model/context.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";

export interface RustRetainedEnvironment {
  readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
  readonly parameters: readonly Node[];
}

export type RustRetainedEnvironmentSelection =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly environment: RustRetainedEnvironment }
  | { readonly kind: "unresolved"; readonly reason: string };

export function rustSuspendedCapturedParameters(declaration: Node, context: RustSourcePolicyContext): readonly Node[] | undefined {
  return context.retainedEnvironments.suspendedParametersFor(declaration);
}

export function rustRetainedEnvironment(
  declaration: Node,
  parameterCarriers: readonly (TargetTypeRef | undefined)[],
  context: RustSourcePolicyContext,
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

export function rustHasOpenOwnedStorage(carrier: TargetTypeRef): boolean {
  if (carrier.kind === "reference" || carrier.kind === "pointer") return false;
  if (rustCallableProtocol(carrier) !== undefined || rustGenericCallableProtocol(carrier) !== undefined ||
    rustNativeCallableProtocol(carrier) !== undefined || carrier.kind === "type-parameter") return true;
  return rustTargetGenericReferences(carrier).typeIdentities.length > 0 ||
    rustTargetTypeChildren(carrier).some(rustHasOpenOwnedStorage);
}
