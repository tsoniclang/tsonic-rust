import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../../model/context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOwnedStorageChildren } from "../storage/owned-storage.js";
import { rustRetainedEnvironment } from "../../ownership/retained-environments.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/retained-environments.js";
import { closeRustSuspendedStorage } from "../storage/suspended-storage.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";

export function closeRustRetainedResult(
  declaration: Node, result: TargetTypeRef, parameters: readonly (TargetTypeRef | undefined)[], context: RustSourcePolicyContext,
): { readonly carrier: TargetTypeRef; readonly environment?: RustRetainedEnvironment } | undefined {
  if (!containsStorage(result)) return Object.freeze({ carrier: result });
  if (context.ast.is.IsFunctionTypeNode(declaration) || context.ast.is.IsCallSignatureDeclaration(declaration) ||
    context.ast.is.IsConstructSignatureDeclaration(declaration) || context.ast.is.IsMethodSignatureDeclaration(declaration)) {
    const carrier = closeRustSuspendedStorage(result, parameters, context.sourceLifetimes.contractFor(declaration),
      "callable-signature");
    return carrier === undefined ? undefined : Object.freeze({ carrier });
  }
  const retained = rustRetainedEnvironment(declaration, parameters, context);
  if (retained.kind === "unresolved") return undefined;
  const environment = retained.kind === "selected" ? retained.environment : undefined;
  const carrier = closeRustSuspendedStorage(result, parameters, context.sourceLifetimes.contractFor(declaration),
    "callable-result", environment?.lifetime);
  return carrier === undefined ? undefined : Object.freeze({ carrier, ...(environment === undefined ? {} : { environment }) });
}

function containsStorage(carrier: TargetTypeRef): boolean {
  return rustCallableProtocol(carrier)?.lifetime !== undefined || rustOwnedStorageChildren(carrier).some(containsStorage);
}
