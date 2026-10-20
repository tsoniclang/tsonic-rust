import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustAwaitSelectionLeaves } from "../../../target-model/types/await.js";
import { rustAwaitSelection } from "../../operations/flow/await.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { emptyRustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustFutureTargetId } from "../../../target-model/types/carriers/primitives.js";
import { rustJsPromiseTargetId } from "../../../target-model/types/carriers/source-types.js";

import { closedMetadataKey, snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";

import type { RustNativeCallableCompletion, RustNativeCompletionFuture } from "../../../target-model/types/callable-completions.js";
export function rustNativeCallableCompletion(
  result: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustNativeCallableCompletion | undefined {
  const selection = rustAwaitSelection(result, definitions);
  if (selection === undefined) return undefined;
  const futures = new Map<string, RustNativeCompletionFuture>();
  for (const leaf of rustAwaitSelectionLeaves(selection)) {
    if (leaf.future === undefined) continue;
    const carrier = leaf.future.futureCarrier;
    if (carrier.kind !== "target-named" || carrier.id !== rustFutureTargetId && carrier.id !== rustJsPromiseTargetId) return undefined;
    const identity = closedMetadataKey(carrier);
    if (!futures.has(identity)) futures.set(identity, Object.freeze({ carrier,
      output: leaf.future.outputCarrier, ordinal: futures.size }));
  }
  return futures.size === 0 ? undefined : snapshotClosedMetadata({ result, selection,
    futures: [...futures.values()] });
}
