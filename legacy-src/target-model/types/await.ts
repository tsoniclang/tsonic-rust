import type { TargetTypeRef } from "./model.js";
import { rustFutureOutputCarrier } from "./carriers/primitives.js";
import { rustOptionElementCarrier } from "./carriers/optional.js";
import { isRustUnitCarrier } from "./carriers/js.js";
import { rustSourceOptionalTargetType } from "./projections.js";
import { rustFutureTargetId } from "./carriers/primitives.js";
import { rustJsPromiseTargetId } from "./carriers/source-types.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "./equality.js";
import { rustUnionAlternatives } from "./union-relations.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "./source-union-definitions.js";
import type { RustRuntimeUnionVariant } from "./carriers/runtime-unions.js";
import { closedMetadataKey, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";

export interface RustAwaitCarrier {
  readonly futureCarrier: TargetTypeRef;
  readonly outputCarrier: TargetTypeRef;
  readonly resultCarrier: TargetTypeRef;
  readonly optional: boolean;
}

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

export interface RustAwaitLeaf {
  readonly carrier: TargetTypeRef;
  readonly future?: RustAwaitCarrier;
}

export type RustAwaitSelection<Leaf = RustAwaitLeaf> =
  | { readonly kind: "leaf"; readonly value: Leaf }
  | { readonly kind: "optional"; readonly carrier: TargetTypeRef; readonly present: RustAwaitSelection<Leaf> }
  | { readonly kind: "union"; readonly carrier: TargetTypeRef;
      readonly alternatives: readonly { readonly variant: RustRuntimeUnionVariant;
        readonly selection: RustAwaitSelection<Leaf> }[] };

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

export function mapRustAwaitSelection<Source, Target>(
  selection: RustAwaitSelection<Source>,
  select: (leaf: Source) => Target | undefined,
): RustAwaitSelection<Target> | undefined {
  if (selection.kind === "leaf") {
    const value = select(selection.value);
    return value === undefined ? undefined : Object.freeze({ kind: "leaf", value });
  }
  if (selection.kind === "optional") {
    const present = mapRustAwaitSelection(selection.present, select);
    return present === undefined ? undefined : Object.freeze({ ...selection, present });
  }
  const alternatives = selection.alternatives.map(alternative => {
    const selected = mapRustAwaitSelection(alternative.selection, select);
    return selected === undefined ? undefined : Object.freeze({ ...alternative, selection: selected });
  });
  return alternatives.some(alternative => alternative === undefined) ? undefined : Object.freeze({ ...selection,
    alternatives: Object.freeze(alternatives as NonNullable<typeof alternatives[number]>[]) });
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

export function rustAwaitSelectionLeaves<Leaf>(selection: RustAwaitSelection<Leaf>): readonly Leaf[] {
  if (selection.kind === "leaf") return [selection.value];
  if (selection.kind === "optional") return rustAwaitSelectionLeaves(selection.present);
  return selection.alternatives.flatMap(alternative => rustAwaitSelectionLeaves(alternative.selection));
}
