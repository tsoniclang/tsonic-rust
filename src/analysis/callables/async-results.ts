import { Node_Type } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustCallableValueConversionMatches } from "../../target-model/conversions/callable.js";
import { rustNativeRepresentationMatches } from "../../target-model/conversions/native-representation.js";
import { isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustPlaceholderLifetime, rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  isRustNeverCarrier,
  rustFutureOutputCarrier,
  rustFutureTargetType,
  rustJsPromiseOutputTargetType,
  rustJsPromiseTargetId,
  rustJsPromiseTargetTypeWithLifetime,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustAsyncFunctionFactKey } from "../facts/keys.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";
import { selectRustInferredReturn } from "./inferred-return.js";
import { resolveRustSuspendedCallableStorage } from "./suspension-storage.js";

export type RustAsyncBodyPromiseSelection =
  | {
      readonly kind: "selected";
      readonly outputCarrier: TargetTypeRef;
      readonly errorCarrier: TargetTypeRef;
      readonly contextualPromise?: TargetTypeRef;
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectRustAsyncBodyPromise(
  sourcePromise: TargetTypeRef,
  inferredOutput: TargetTypeRef | undefined,
  contextualResult: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions,
): RustAsyncBodyPromiseSelection {
  if (!isClosedMetadata(sourcePromise) || !isRustTargetTypeRef(sourcePromise) ||
    rustJsPromiseOutputTargetType(sourcePromise) === undefined ||
    inferredOutput === undefined || !isClosedMetadata(inferredOutput) || !isRustTargetTypeRef(inferredOutput)) {
    return { kind: "rejected", reason: "An authored async body requires an exact JS promise output and error protocol." };
  }
  const error = sourcePromise.kind === "target-named" ? sourcePromise.genericArguments?.[2] : undefined;
  if (error?.kind !== "type") {
    return { kind: "rejected", reason: "An authored async body has no exact JS promise error carrier." };
  }
  const inferred: RustAsyncBodyPromiseSelection = Object.freeze({
    kind: "selected", outputCarrier: inferredOutput, errorCarrier: error.type,
  });
  if (contextualResult === undefined) return inferred;
  const awaited = rustAwaitSelection(contextualResult, definitions);
  if (awaited === undefined) {
    return { kind: "rejected", reason: "The contextual async result has no bounded, closed native promise alternatives." };
  }
  const promises = rustAwaitSelectionLeaves(awaited).flatMap(leaf =>
    leaf.future?.futureCarrier.kind === "target-named" && leaf.future.futureCarrier.id === rustJsPromiseTargetId
      ? [leaf.future.futureCarrier] : []);
  if (promises.length === 0) return inferred;
  const admitted = promises.flatMap(contextualPromise => {
    const output = rustJsPromiseOutputTargetType(contextualPromise);
    const contextualError = contextualPromise.genericArguments?.[2];
    if (output === undefined || contextualError?.kind !== "type" ||
      !rustTargetTypeRefEquals(error.type, contextualError.type)) return [];
    if (rustNativeRepresentationMatches(inferredOutput, output) ||
      rustCallableValueConversionMatches({ kind: "absence" }, inferredOutput, output, definitions)) {
      return [{ outputCarrier: output, contextualPromise }];
    }
    const conversion = selectRustSourceValueConversion(inferredOutput, output, definitions);
    return conversion !== undefined && rustCallableValueConversionMatches(
      { kind: "value", conversion }, inferredOutput, output, definitions)
      ? [{ outputCarrier: output, contextualPromise }] : [];
  });
  if (admitted.length !== 1) {
    return { kind: "rejected", reason: "An authored async body requires one unambiguous contextual JS promise alternative admitting its output and exact rejection carrier." };
  }
  return Object.freeze({ kind: "selected", ...admitted[0]!, errorCarrier: error.type });
}

export function recordRustAsyncBodyFacts(
  walk: RustFactWalk,
  declaration: Node,
  futureCarrier: TargetTypeRef | undefined,
  ownedReceiver?: TargetTypeRef,
  contextualResult?: TargetTypeRef,
): void {
  const { ast } = walk.context;
  const inferred = selectRustInferredReturn(walk, declaration, rustFutureOutputCarrier(futureCarrier));
  const contextualLiteral = Node_Type(ast, declaration) === undefined &&
    (ast.is.IsArrowFunction(declaration) || ast.is.IsFunctionExpression(declaration));
  const isJsPromise = futureCarrier?.kind === "target-named" && futureCarrier.id === rustJsPromiseTargetId;
  const closedContext = contextualResult?.kind === "opaque" && contextualResult.id === "tsonic.rust.infer"
    ? undefined : contextualResult;
  const sourceContext = contextualLiteral && closedContext === undefined && (isJsPromise || isRustNeverCarrier(inferred))
    ? walk.context.semanticsFor(declaration).types.contextualType(declaration) : undefined;
  const callableContext = sourceContext === undefined ? undefined
    : walk.context.semanticsFor(declaration).types.callable(sourceContext);
  const selectedContext = contextualLiteral
    ? closedContext ?? (callableContext === undefined ? undefined : resolveRustTargetTypeRef(
      callableContext.result.selectedType, rustResolutionContext(walk, declaration), walk.operationOptions))
    : undefined;
  if (!isJsPromise) {
    const inner = !isRustNeverCarrier(inferred) || selectedContext === undefined ? inferred
      : rustFutureOutputCarrier(rustOptionElementCarrier(selectedContext) ?? selectedContext);
    if (inner !== undefined) walk.context.facts.set(declaration, rustAsyncFunctionFactKey, {
      kind: "native-future", isAsync: true, futureCarrier: rustFutureTargetType(inner), outputCarrier: inner,
    }, [{ message: "rust async function" }]);
    return;
  }
  const selected = selectRustAsyncBodyPromise(futureCarrier, inferred, selectedContext, walk.context.typeDefinitions);
  if (selected.kind === "rejected") {
    appendRustDiagnostic(walk, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED", selected.reason,
      declaration, ["target.capability=rust.async.contextual-promise-output"]);
    return;
  }
  const storage = resolveRustSuspendedCallableStorage(walk, declaration,
    [selected.outputCarrier, selected.errorCarrier], ownedReceiver);
  if (storage.kind === "rejected") {
    appendRustDiagnostic(walk, "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", storage.reason,
      declaration, ["target.capability=rust.async.js-promise-storage-lifetime"]);
    return;
  }
  const closedFutureCarrier = rustJsPromiseTargetTypeWithLifetime(selected.outputCarrier,
    storage.storage.kind === "static" ? rustStaticLifetime
      : storage.storage.kind === "receiver" ? rustPlaceholderLifetime : storage.storage.lifetime,
    selected.errorCarrier);
  if (selected.contextualPromise !== undefined &&
    !rustNativeRepresentationMatches(closedFutureCarrier, selected.contextualPromise)) {
    appendRustDiagnostic(walk, "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN",
      "The authored async body's proven storage lifetime cannot enter its selected contextual promise.",
      declaration, ["target.capability=rust.async.js-promise-storage-lifetime"]);
    return;
  }
  walk.context.facts.set(declaration, rustAsyncFunctionFactKey, {
    kind: "js-promise", isAsync: true, futureCarrier: closedFutureCarrier,
    outputCarrier: selected.outputCarrier, capturedParameters: storage.capturedParameters,
    storage: storage.storage,
    ...(storage.ownedReceiver === undefined ? {} : { ownedReceiver: storage.ownedReceiver }),
  }, [{ message: "rust async function" }]);
}
