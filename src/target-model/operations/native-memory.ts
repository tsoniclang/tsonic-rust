import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { defineRustPlanKey } from "../facts/keys.js";

export interface RustNativeMemoryLayout {
  readonly kind: "scalar" | "record";
  readonly pointeeCarrier: TargetTypeRef;
  readonly size: number;
  readonly alignment: number;
  readonly width: 32 | 64;
  readonly littleEndian: boolean;
  readonly fields: readonly RustNativeMemoryField[];
}

export interface RustNativeMemoryField {
  readonly name: string;
  readonly offset: number;
  readonly alignment: number;
  readonly layout: RustNativeMemoryLayout;
}

export interface RustNativeObjectField {
  readonly owner: TargetTypeRef;
  readonly storageIndex: number;
  readonly layout: RustNativeMemoryLayout;
}

export type RustNativeArrayStorage = {
  readonly layout: RustNativeMemoryLayout;
  readonly stride: number;
} & ({ readonly kind: "element"; readonly declaration: Node } |
  { readonly kind: "binding" | "reference" | "literal" });

export const rustNativeArrayStorageKey = defineRustPlanKey<RustNativeArrayStorage>("nativeArrayStorage", (left, right) =>
  left.kind === right.kind && (left.kind !== "element" || right.kind === "element" && left.declaration === right.declaration) && left.stride === right.stride &&
  rustNativeMemoryLayoutsEqual(left.layout, right.layout));

export function rustNativeMemoryLayoutsEqual(left: RustNativeMemoryLayout, right: RustNativeMemoryLayout): boolean {
  const pending = [[left, right] as const];
  const visited = new Map<RustNativeMemoryLayout, Set<RustNativeMemoryLayout>>();
  while (pending.length > 0) {
    const [first, second] = pending.pop()!;
    if (visited.get(first)?.has(second)) continue;
    const compared = visited.get(first) ?? new Set<RustNativeMemoryLayout>();
    compared.add(second);
    visited.set(first, compared);
    if (first.kind !== second.kind || !rustTargetTypeRefEquals(first.pointeeCarrier, second.pointeeCarrier) ||
      first.size !== second.size || first.alignment !== second.alignment || first.width !== second.width ||
      first.littleEndian !== second.littleEndian || first.fields.length !== second.fields.length) return false;
    for (const [index, field] of first.fields.entries()) {
      const other = second.fields[index]!;
      if (field.name !== other.name || field.offset !== other.offset || field.alignment !== other.alignment) return false;
      pending.push([field.layout, other.layout]);
    }
  }
  return true;
}

export const rustNativeBackingKey = defineRustPlanKey<RustNativeMemoryLayout>("nativeBacking", rustNativeMemoryLayoutsEqual);

export interface RustRawLocationPlan {
  readonly operation: "to-raw" | "reinterpret";
  readonly expression: Node;
  readonly inputCarrier: TargetTypeRef;
  readonly layout: RustNativeMemoryLayout;
}

export const rustRawLocationPlanKey = defineRustPlanKey<RustRawLocationPlan>("rawLocation", (left, right) =>
  left.operation === right.operation && left.expression === right.expression &&
  rustTargetTypeRefEquals(left.inputCarrier, right.inputCarrier) && rustNativeMemoryLayoutsEqual(left.layout, right.layout));
