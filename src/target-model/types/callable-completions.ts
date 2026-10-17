import type { RustTargetGenericArgument, TargetTypeRef } from "./model.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves, type RustAwaitSelection } from "./await.js";
import type { RustTypeDefinitions } from "./source-union-definitions.js";
import { emptyRustTypeDefinitions, instantiateRustSourceUnionPayloads } from "./source-union-definitions.js";
import { rustFutureTargetId } from "./carriers/primitives.js";
import { rustJsPromiseTargetId } from "./carriers/source-types.js";
import { rustNamedTargetType } from "./carriers/native.js";
import { rustTypeGenericArguments } from "./generic-arguments.js";
import { closedMetadataKey, isDenseDataArray, snapshotClosedMetadata } from "../metadata/closed-data.js";
import { isRustTargetGenericArgument, isRustTargetTypeRef } from "./equality.js";
import { instantiateRustRuntimeUnionPayloads } from "./carriers/runtime-unions.js";
import { rustSourceUnionCarrierValue } from "./carriers/source-types.js";

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
    if (carrier.kind !== "target-named" || carrier.id !== rustFutureTargetId && carrier.id !== rustJsPromiseTargetId) return undefined;
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
  definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  const selected = new Map<string, TargetTypeRef>();
  for (const future of completion.futures) {
    const replacement = select(future);
    if (replacement === undefined || !isRustTargetTypeRef(replacement)) return undefined;
    selected.set(closedMetadataKey(future.carrier), replacement);
  }
  const visit = (selection: RustAwaitSelection): TargetTypeRef | undefined => {
    if (selection.kind === "leaf") return selection.value.future === undefined ? selection.value.carrier
      : selected.get(closedMetadataKey(selection.value.future.futureCarrier));
    if (selection.kind === "optional") {
      const present = visit(selection.present);
      return present === undefined || selection.carrier.kind !== "target-named" ? undefined
        : { ...selection.carrier, genericArguments: rustTypeGenericArguments([present]) };
    }
    const payloads = selection.alternatives.map(alternative => visit(alternative.selection));
    if (payloads.some(payload => payload === undefined)) return undefined;
    return rustSourceUnionCarrierValue(selection.carrier) === undefined
      ? instantiateRustRuntimeUnionPayloads(selection.carrier, payloads as TargetTypeRef[])
      : instantiateRustSourceUnionPayloads(selection.carrier, payloads as TargetTypeRef[], definitions);
  };
  const result = visit(completion.selection);
  return result === undefined ? undefined : snapshotClosedMetadata(result);
}

export function rustNativeCompletionFutureType(input: {
  readonly identity: string;
  readonly output: TargetTypeRef;
  readonly error: TargetTypeRef;
  readonly captures: readonly RustTargetGenericArgument[];
}): TargetTypeRef {
  return rustNativeFutureOutputType({ ...input, output: rustNamedTargetType("rust.core.Result", "Result",
    rustTypeGenericArguments([input.output, input.error]), [], undefined, [], undefined, []) });
}

export function rustNativeFutureOutputType(input: {
  readonly identity: string;
  readonly output: TargetTypeRef;
  readonly captures: readonly RustTargetGenericArgument[];
  readonly ready?: boolean;
}): TargetTypeRef {
  if (!isDenseDataArray(input.captures) || !input.captures.every(isRustTargetGenericArgument)) {
    throw new Error("A source native Future requires explicit exact capture evidence.");
  }
  if (input.ready === true) return rustNamedTargetType("rust.core.future.Ready", "core::future::Ready",
    rustTypeGenericArguments([input.output]), [], undefined, [], undefined, []);
  return snapshotClosedMetadata({ kind: "impl-trait", id: input.identity,
    bounds: [{ kind: "trait-ref", id: "rust.core.Future", path: "core::future::Future",
      genericArguments: [], associatedConstraints: [{ kind: "equality", identity: "rust.core.Future.Output",
        name: "Output", genericArguments: [], type: input.output }] }],
    outlives: [], captures: input.captures });
}
