import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../model/context.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustJsPromiseTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustRetainedEnvironment, type RustRetainedEnvironment } from "../ownership/retained-environments.js";
import { closeRustSuspendedStorage } from "./suspended-storage.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";

export function closeRustRetainedResult(
  declaration: Node, result: TargetTypeRef, parameters: readonly (TargetTypeRef | undefined)[], context: RustSourcePolicyContext,
): { readonly carrier: TargetTypeRef; readonly environment?: RustRetainedEnvironment } | undefined {
  const retained = containsStorage(result) ? rustRetainedEnvironment(declaration, parameters, context) : { kind: "none" as const };
  if (retained.kind === "unresolved") return undefined;
  const environment = retained.kind === "selected" ? retained.environment : undefined;
  const carrier = closeRustSuspendedStorage(result, parameters, context.sourceLifetimes.contractFor(declaration),
    "callable-result", environment?.lifetime);
  return carrier === undefined ? undefined : Object.freeze({ carrier, ...(environment === undefined ? {} : { environment }) });
}

function containsStorage(carrier: TargetTypeRef): boolean {
  return carrier.kind === "target-named" && carrier.id === rustJsPromiseTargetId ||
    rustCallableProtocol(carrier)?.lifetime !== undefined || rustTargetTypeChildren(carrier).some(containsStorage);
}
