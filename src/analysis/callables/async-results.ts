import { Node_Type } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustCallableValueConversionMatches } from "../../target-model/conversions/callable.js";
import { rustNativeRepresentationMatches } from "../../target-model/conversions/native-representation.js";
import { isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";
import {
  isRustNeverCarrier,
  rustFutureOutputCarrier,
  rustJsPromiseOutputTargetType,
  rustJsPromiseTargetId,
  rustJsPromiseTargetType,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";

import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";
import { selectRustInferredReturn } from "./inferred-return.js";
import { resolveRustSuspendedCallableStorage } from "./suspension-storage.js";
import type { RustAsyncFunctionFact } from "../../target-model/records/callables-and-resources.js";
import type { RustRetainedEnvironment } from "../../target-model/records/retained-environments.js";
import { rustNativeAsyncFunctionFact, rustPromiseAsyncFunctionFact } from "../program/records/async-function.js";

export type RustAsyncBodyPromiseSelection =
  | {
      readonly kind: "selected";
      readonly outputCarrier: TargetTypeRef;
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
    return { kind: "rejected", reason: "An authored async body requires an exact JS promise output." };
  }
  const inferred: RustAsyncBodyPromiseSelection = Object.freeze({ kind: "selected", outputCarrier: inferredOutput });
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
    if (output === undefined) return [];
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
    return { kind: "rejected", reason: "An authored async body requires one unambiguous contextual JS promise alternative admitting its output." };
  }
  return Object.freeze({ kind: "selected", ...admitted[0]! });
}

export function selectRustAsyncBodyFacts(
  walk: RustFactWalk,
  declaration: Node,
  futureCarrier: TargetTypeRef | undefined,
  ownedReceiver?: TargetTypeRef,
  contextualResult?: TargetTypeRef,
): { readonly fact: RustAsyncFunctionFact; readonly retainedEnvironment?: RustRetainedEnvironment } | undefined {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const inference = selectRustInferredReturn(walk, declaration, rustFutureOutputCarrier(futureCarrier));
  if (inference.kind === "pending") return undefined;
  const inferred = inference.carrier;
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
    return inner === undefined ? undefined : { fact: rustNativeAsyncFunctionFact(inner) };
  }
  const selected = selectRustAsyncBodyPromise(futureCarrier, inferred, selectedContext, walk.context.typeDefinitions);
  if (selected.kind === "rejected") {
    appendRustDiagnostic(walk, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED", selected.reason,
      declaration, ["target.capability=rust.async.contextual-promise-output"]);
    return;
  }
  const storage = resolveRustSuspendedCallableStorage(walk, declaration, [selected.outputCarrier], ownedReceiver);
  if (storage.kind === "rejected") {
    appendRustDiagnostic(walk, "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", storage.reason,
      declaration, ["target.capability=rust.async.js-promise-storage-lifetime"]);
    return;
  }
  const closedFutureCarrier = rustJsPromiseTargetType(selected.outputCarrier);
  if (selected.contextualPromise !== undefined &&
    !rustNativeRepresentationMatches(closedFutureCarrier, selected.contextualPromise)) {
    appendRustDiagnostic(walk, "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN",
      "The authored async body's proven storage lifetime cannot enter its selected contextual promise.",
      declaration, ["target.capability=rust.async.js-promise-storage-lifetime"]);
    return;
  }
  return { fact: rustPromiseAsyncFunctionFact(closedFutureCarrier, selected.outputCarrier, storage),
    ...(storage.retainedEnvironment === undefined ? {} : { retainedEnvironment: storage.retainedEnvironment }),
  };
}
