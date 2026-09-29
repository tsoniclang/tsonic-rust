import { allocateRustGeneratedName } from "./generated.js";
import { isValidRustAuthoredIdentifier, rustSnakeCaseIdentifier, rustTargetIdentifier } from "./identifiers.js";

export function rustPropertyStorageNames(sourceNames: readonly string[]): ReadonlyMap<string, string> {
  const names = new Map(sourceNames.filter(isValidRustAuthoredIdentifier)
    .map(name => [name, rustTargetIdentifier(name)]));
  const reserved = new Set(names.values());
  for (const name of [...new Set(sourceNames)].sort()) {
    if (!names.has(name)) names.set(name, allocateRustGeneratedName(reserved, rustSnakeCaseIdentifier(name)));
  }
  return names;
}
