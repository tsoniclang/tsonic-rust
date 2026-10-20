import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustFutureOutputCarrier } from "../../../target-model/types/carriers/primitives.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { isRustUnitCarrier } from "../../../target-model/types/carriers/js.js";
import { rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";
import { rustFutureTargetId } from "../../../target-model/types/carriers/primitives.js";
import { rustJsPromiseTargetId } from "../../../target-model/types/carriers/source-types.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";

import { closedMetadataKey, isClosedMetadata, isDenseDataArray } from "../../../target-model/metadata/closed-data.js";

import { rustAwaitSelectionLeaves, type RustAwaitCarrier, type RustAwaitSelection } from "../../../target-model/types/await.js";
export function rustAwaitCarrier(carrier: TargetTypeRef | undefined): RustAwaitCarrier | undefined {
  if (carrier === undefined) return undefined;
  const optional = rustOptionElementCarrier(carrier);
  const futureCarrier = optional ?? carrier;
  const outputCarrier = rustFutureOutputCarrier(futureCarrier);
  return outputCarrier === undefined ? undefined : {
    futureCarrier, outputCarrier, optional: optional !== undefined,
    resultCarrier: optional === undefined || isRustUnitCarrier(outputCarrier)
      ? outputCarrier : rustSourceOptionalTargetType(outputCarrier),
  };
}

export function rustAwaitSelection(
  carrier: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustAwaitSelection | undefined {
  let remaining = 4096;
  const visit = (current: TargetTypeRef, ancestors: ReadonlySet<string>): RustAwaitSelection | undefined => {
    if (remaining-- <= 0 || ancestors.size >= 128 || !isClosedMetadata(current) || !isRustTargetTypeRef(current)) return undefined;
    const identity = closedMetadataKey(current);
    if (ancestors.has(identity)) return undefined;
    const nextAncestors = new Set([...ancestors, identity]);
    const element = rustOptionElementCarrier(current);
    if (element !== undefined) {
      const present = visit(element, nextAncestors);
      return present === undefined ? undefined : rustAwaitSelectionLeaves(present).some(leaf => leaf.future !== undefined)
        ? Object.freeze({ kind: "optional", carrier: current, present })
        : Object.freeze({ kind: "leaf", value: Object.freeze({ carrier: current }) });
    }
    const alternatives = rustUnionAlternatives(current, definitions);
    if (alternatives !== undefined) {
      if (!isClosedMetadata(alternatives) || !isDenseDataArray(alternatives) ||
        alternatives.length === 0 || alternatives.length > remaining ||
        alternatives.some(alternative => typeof alternative.variant.name !== "string" || alternative.variant.name.length === 0) ||
        new Set(alternatives.map(alternative => alternative.variant.name)).size !== alternatives.length) return undefined;
      const selected = alternatives.map(alternative => {
        const selection = visit(alternative.carrier, nextAncestors);
        return selection === undefined ? undefined : Object.freeze({ variant: alternative.variant, selection });
      });
      if (selected.some(alternative => alternative === undefined)) return undefined;
      const completed = selected as NonNullable<typeof selected[number]>[];
      return completed.some(alternative => rustAwaitSelectionLeaves(alternative.selection).some(leaf => leaf.future !== undefined))
        ? Object.freeze({ kind: "union", carrier: current, alternatives: Object.freeze(completed) })
        : Object.freeze({ kind: "leaf", value: Object.freeze({ carrier: current }) });
    }
    const future = rustAwaitCarrier(current);
    if (future === undefined && (current.kind === "target-named" &&
        (current.id === rustFutureTargetId || current.id === rustJsPromiseTargetId) ||
      current.kind === "opaque" || current.kind === "type-parameter" || current.kind === "associated-type" ||
      current.kind === "impl-trait" || current.kind === "trait-object")) return undefined;
    return Object.freeze({ kind: "leaf", value: Object.freeze({ carrier: current,
      ...(future === undefined ? {} : { future }) }) });
  };
  return carrier === undefined ? undefined : visit(carrier, new Set());
}

export function rustAwaitSelectionResultCarrier(selection: RustAwaitSelection | undefined): TargetTypeRef | undefined {
  if (selection === undefined) return undefined;
  if (selection.kind === "leaf") return selection.value.future?.outputCarrier ?? selection.value.carrier;
  if (selection.kind === "optional") {
    const present = rustAwaitSelectionResultCarrier(selection.present);
    return present === undefined ? undefined : isRustUnitCarrier(present) ? present : rustSourceOptionalTargetType(present);
  }
  const outputs = selection.alternatives.map(alternative => rustAwaitSelectionResultCarrier(alternative.selection));
  if (outputs.some(output => output === undefined)) return undefined;
  const present = outputs.filter(output => !isRustUnitCarrier(output)) as TargetTypeRef[];
  if (present.length === 0) return outputs[0];
  const selected = present[0]!;
  if (present.some(output => !rustTargetTypeRefEquals(output, selected))) return undefined;
  return present.length === outputs.length ? selected : rustSourceOptionalTargetType(selected);
}
