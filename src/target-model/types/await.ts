import type { TargetTypeRef } from "./model.js";

import type { RustRuntimeUnionVariant } from "./carriers/runtime-unions.js";

export interface RustAwaitCarrier {
  readonly futureCarrier: TargetTypeRef;
  readonly outputCarrier: TargetTypeRef;
  readonly resultCarrier: TargetTypeRef;
  readonly optional: boolean;
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

export function rustAwaitSelectionLeaves<Leaf>(selection: RustAwaitSelection<Leaf>): readonly Leaf[] {
  if (selection.kind === "leaf") return [selection.value];
  if (selection.kind === "optional") return rustAwaitSelectionLeaves(selection.present);
  return selection.alternatives.flatMap(alternative => rustAwaitSelectionLeaves(alternative.selection));
}
