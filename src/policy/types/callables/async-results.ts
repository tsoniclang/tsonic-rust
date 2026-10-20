import { rustCallableValueConversionMatches } from "../../conversions/callable.js";
import { rustNativeRepresentationMatches } from "../../conversions/native-representation.js";
import { isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustAwaitSelectionLeaves } from "../../../target-model/types/await.js";
import { rustAwaitSelection } from "../../operations/flow/await.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { rustJsPromiseOutputTargetType, rustJsPromiseTargetId } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { selectRustSourceValueConversion } from "../../conversions/selection.js";

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
