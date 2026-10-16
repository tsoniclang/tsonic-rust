import type { RustRetainedEnvironment } from "../../target-model/records/retained-environments.js";
import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../model/context.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustCallableProtocol, rustCallableTargetType, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { rustOwnedStorageChild, rustOwnedStorageChildren } from "../types/storage/owned-storage.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";

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

export function closeRustRetainedParameter(
  parameter: Node, carrier: TargetTypeRef, context: RustSourcePolicyContext,
): TargetTypeRef | undefined {
  if (!hasOpenCallableEnvironment(carrier)) return carrier;
  if (!context.ast.is.IsParameterDeclaration(parameter)) return undefined;
  const declaration = context.ast.parent(parameter);
  if (declaration === undefined || !context.ast.parameters(declaration).includes(parameter)) return undefined;
  const selected = context.retainedEnvironments.environmentFor(declaration);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "none" || !selected.environment.parameters.includes(parameter)) return carrier;
  return mapRustTargetTypes(carrier, (current, original) => {
    if (original.kind === "reference" || original.kind === "function-pointer" || original.kind === "closure") return original;
    const protocol = rustCallableProtocol(original);
    return protocol === undefined ? current : protocol.lifetime?.kind === "placeholder"
      ? rustCallableTargetType(protocol.parameters, protocol.result, selected.environment.lifetime, protocol.error) : original;
  }, rustOwnedStorageChild);
}

function hasOpenCallableEnvironment(carrier: TargetTypeRef): boolean {
  if (carrier.kind === "reference" || carrier.kind === "pointer" ||
    carrier.kind === "function-pointer" || carrier.kind === "closure") return false;
  const protocol = rustCallableProtocol(carrier);
  if (protocol !== undefined) return protocol.lifetime?.kind === "placeholder";
  if (rustGenericCallableProtocol(carrier) !== undefined || rustNativeCallableProtocol(carrier) !== undefined) return false;
  return rustOwnedStorageChildren(carrier).some(hasOpenCallableEnvironment);
}

export function rustHasOpenOwnedStorage(carrier: TargetTypeRef): boolean {
  if (carrier.kind === "reference" || carrier.kind === "pointer") return false;
  if (rustCallableProtocol(carrier) !== undefined || rustGenericCallableProtocol(carrier) !== undefined ||
    rustNativeCallableProtocol(carrier) !== undefined || carrier.kind === "type-parameter") return true;
  return rustOwnedStorageChildren(carrier).some(rustHasOpenOwnedStorage);
}
