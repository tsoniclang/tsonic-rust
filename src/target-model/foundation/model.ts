export const rustFoundations = Object.freeze(["core", "alloc", "std"] as const);

export type RustFoundation = typeof rustFoundations[number];

const rustFoundationRank: Readonly<Record<RustFoundation, number>> = Object.freeze({
  core: 0,
  alloc: 1,
  std: 2,
});

export function isRustFoundation(value: unknown): value is RustFoundation {
  return value === "core" || value === "alloc" || value === "std";
}

export function rustFoundationIncludes(
  selected: RustFoundation,
  required: RustFoundation,
): boolean {
  return rustFoundationRank[selected] >= rustFoundationRank[required];
}

export function maximumRustFoundation(
  left: RustFoundation,
  right: RustFoundation,
): RustFoundation {
  return rustFoundationRank[left] >= rustFoundationRank[right] ? left : right;
}
