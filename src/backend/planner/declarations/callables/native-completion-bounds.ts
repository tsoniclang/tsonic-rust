import type { RustNativeCompletionFuture } from "../../../../target-model/types/callable-completions.js";
import { rustJsPromiseTargetId } from "../../../../target-model/types/carriers/source-types.js";
import type { RustTypeBound } from "../../../target-ast/nodes.js";
import { rustLifetimeToAst } from "../../types/lifetime-syntax.js";

export function rustNativeCompletionErrorBounds(future: RustNativeCompletionFuture): readonly RustTypeBound[] {
  if (future.carrier.kind !== "target-named" || future.carrier.id !== rustJsPromiseTargetId) return [];
  const lifetime = future.carrier.genericArguments?.[0];
  if (lifetime?.kind !== "lifetime") throw new Error("A sealed JS completion requires its exact shared-future lifetime.");
  return [{ kind: "trait", path: "core::clone::Clone" },
    { kind: "lifetime", lifetime: rustLifetimeToAst(lifetime.lifetime) }];
}
