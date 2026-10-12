import type { RustTargetGenericArgument, TargetTypeRef } from "./model.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves, type RustAwaitSelection } from "./await.js";
import type { RustTypeDefinitions } from "./source-union-definitions.js";
import { emptyRustTypeDefinitions } from "./source-union-definitions.js";
import { mapRustTargetTypes } from "./carriers/substitution.js";
import { rustFutureTargetId } from "./carriers/primitives.js";
import { rustNamedTargetType } from "./carriers/native.js";
import { rustTypeGenericArguments } from "./generic-arguments.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../metadata/closed-data.js";
import { isRustTargetTypeRef } from "./equality.js";

export interface RustNativeCompletionFuture {
  readonly carrier: TargetTypeRef;
  readonly output: TargetTypeRef;
  readonly ordinal: number;
}

export interface RustNativeCallableCompletion {
  readonly result: TargetTypeRef;
  readonly selection: RustAwaitSelection;
  readonly futures: readonly RustNativeCompletionFuture[];
}

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
    if (carrier.kind !== "target-named" || carrier.id !== rustFutureTargetId) return undefined;
    const identity = closedMetadataKey(carrier);
    if (!futures.has(identity)) futures.set(identity, Object.freeze({ carrier,
      output: leaf.future.outputCarrier, ordinal: futures.size }));
  }
  return futures.size === 0 ? undefined : snapshotClosedMetadata({ result, selection,
    futures: [...futures.values()] });
}

export function instantiateRustNativeCompletion(
  completion: RustNativeCallableCompletion,
  select: (future: RustNativeCompletionFuture) => TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const selected = new Map<string, TargetTypeRef>();
  for (const future of completion.futures) {
    const replacement = select(future);
    if (replacement === undefined || !isRustTargetTypeRef(replacement)) return undefined;
    selected.set(closedMetadataKey(future.carrier), replacement);
  }
  return mapRustTargetTypes(completion.result, (type, source) => selected.get(closedMetadataKey(source)) ?? type);
}

export function rustNativeCompletionFutureType(input: {
  readonly identity: string;
  readonly output: TargetTypeRef;
  readonly error: TargetTypeRef;
  readonly captures: readonly RustTargetGenericArgument[];
}): TargetTypeRef {
  return snapshotClosedMetadata({ kind: "impl-trait", id: input.identity,
    bounds: [{ kind: "trait-ref", id: "rust.core.Future", path: "core::future::Future",
      genericArguments: [], associatedConstraints: [{ kind: "equality", identity: "rust.core.Future.Output",
        name: "Output", genericArguments: [], type: rustNamedTargetType("rust.core.Result", "Result",
          rustTypeGenericArguments([input.output, input.error])) }] }],
    outlives: [], captures: input.captures });
}
