import { rustModuleSegmentName } from "../../../target-model/names/identifiers.js";
import type { RustSourceFileOutputIdentity } from "../../../target-model/names/source-output-identities.js";

export function allocateRustSupportModuleName(
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  preferredName: string,
  additionalReservedNames: readonly string[] = [],
): string {
  const usedNames = new Set(additionalReservedNames);
  for (const identity of identities.values()) {
    if (identity.externalCrateName !== undefined) {
      continue;
    }
    const topLevelName = identity.moduleSegments[0];
    if (topLevelName !== undefined) {
      usedNames.add(topLevelName);
    }
  }
  const baseName = rustModuleSegmentName(preferredName);
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function allocateRustComponentSupportModuleName(
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  componentId: string,
  preferredName: string,
  additionalReservedNames: readonly string[] = [],
): string {
  const usedNames = new Set(additionalReservedNames);
  for (const identity of identities.values()) {
    if (identity.componentId !== componentId) {
      continue;
    }
    const topLevelName = identity.moduleSegments[0];
    if (topLevelName !== undefined) {
      usedNames.add(topLevelName);
    }
  }
  const baseName = rustModuleSegmentName(preferredName);
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}
