import { rustSnakeCaseIdentifier } from "./rust-identifiers.js";

export function allocateRustGeneratedName(
  usedNames: Set<string>,
  preferred: string,
): string {
  let candidate = preferred;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${preferred}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

export function rustGeneratedNameComponent(name: string): string {
  const targetName = rustSnakeCaseIdentifier(name);
  return targetName.startsWith("r#") ? targetName.slice(2) : targetName;
}
