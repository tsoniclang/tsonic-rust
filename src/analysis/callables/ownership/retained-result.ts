import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../../../policy/model/context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustOwnedStorageChildren } from "../../../policy/types/storage/owned-storage.js";
import { rustRetainedEnvironment } from "./retained-values.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/retained-environments.js";
import { closeRustSuspendedStorage } from "../../../policy/types/storage/suspended-storage.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustLifetimeKey, rustStaticLifetime } from "../../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";

export function closeRustRetainedResult(
  declaration: Node, result: TargetTypeRef, parameters: readonly (TargetTypeRef | undefined)[], context: RustSourcePolicyContext,
): { readonly carrier: TargetTypeRef; readonly environment?: RustRetainedEnvironment } | undefined {
  if (!containsStorage(result)) return Object.freeze({ carrier: result });
  if (context.ast.is.IsFunctionTypeNode(declaration) || context.ast.is.IsCallSignatureDeclaration(declaration) ||
    context.ast.is.IsConstructSignatureDeclaration(declaration) || context.ast.is.IsMethodSignatureDeclaration(declaration) ||
    context.ast.body(declaration) === undefined) {
    const carrier = closeRustSuspendedStorage(result, "callable-signature");
    return carrier === undefined ? undefined : Object.freeze({ carrier });
  }
  const retained = rustRetainedEnvironment(declaration, parameters, context);
  if (retained.kind === "unresolved") return undefined;
  const environment = retained.kind === "selected" ? retained.environment : undefined;
  // Without an open input the result's open callable storage follows Rust output elision when its inputs carry
  // exactly one lifetime parameter; otherwise the result retains only storage it owns and that storage is 'static.
  const inputLifetimes = new Map(parameters.flatMap(parameter => parameter === undefined ? []
    : rustTargetGenericReferences(parameter).lifetimes).filter(lifetime => lifetime.kind === "parameter")
    .map(lifetime => [rustLifetimeKey(lifetime), lifetime] as const));
  const lifetime = environment?.lifetime ?? (inputLifetimes.size === 1 ? [...inputLifetimes.values()][0]! : rustStaticLifetime);
  const carrier = closeRustSuspendedStorage(result, "callable-result", lifetime);
  return carrier === undefined ? undefined : Object.freeze({ carrier, ...(environment === undefined ? {} : { environment }) });
}

function containsStorage(carrier: TargetTypeRef): boolean {
  return rustCallableProtocol(carrier)?.lifetime !== undefined || rustOwnedStorageChildren(carrier).some(containsStorage);
}
