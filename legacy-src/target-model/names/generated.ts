import { rustSnakeCaseIdentifier, rustTargetIdentifier } from "./identifiers.js";

export function allocateRustGeneratedName(
  usedNames: Set<string>,
  preferred: string,
): string {
  const semanticName = preferred.startsWith("r#") ? preferred.slice(2) : preferred;
  let candidate = rustTargetIdentifier(semanticName);
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = rustTargetIdentifier(`${semanticName}_${suffix}`);
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

export function rustGeneratedNameComponent(name: string): string {
  const targetName = rustSnakeCaseIdentifier(name);
  return targetName.startsWith("r#") ? targetName.slice(2) : targetName;
}
