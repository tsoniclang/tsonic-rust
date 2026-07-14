import type { TsonicTargetCapabilityPlugin } from "@tsonic/target-api";

// Local capability composition checks for the Rust target. This is NOT host
// discovery: the host discovers installed plugins and hands the composed set
// to the target. These checks validate a given set of capability plugin
// objects for one selected target and fail closed on conflicts.

export interface RustCapabilityCompositionResult {
  readonly capabilities: readonly TsonicTargetCapabilityPlugin[];
}

export function composeRustCapabilities(
  targetId: string,
  candidates: readonly TsonicTargetCapabilityPlugin[],
  selectedSurfaceIds: readonly string[],
): RustCapabilityCompositionResult {
  const owners = new Map<string, string>();
  const capabilityIds = new Set<string>();
  const selectedSurfaces = new Set(selectedSurfaceIds);
  const capabilities: TsonicTargetCapabilityPlugin[] = [];
  for (const capability of candidates) {
    if (capability.kind !== "target-capability") {
      throw new Error(`Plugin '${(capability as { id?: string }).id ?? "<unknown>"}' is not a target capability.`);
    }
    if (capability.targetId !== targetId) {
      throw new Error(
        `Capability '${capability.id}' targets '${capability.targetId}', not selected target '${targetId}'.`,
      );
    }
    if (capabilityIds.has(capability.id)) {
      throw new Error(`Target '${targetId}' selected capability '${capability.id}' more than once.`);
    }
    capabilityIds.add(capability.id);
    const missingSurfaces = (capability.requiredSurfaces ?? []).filter((surface) => !selectedSurfaces.has(surface));
    if (missingSurfaces.length > 0) {
      throw new Error(`Capability '${capability.id}' requires unselected surface${missingSurfaces.length === 1 ? "" : "s"} ${missingSurfaces.map((surface) => `'${surface}'`).join(", ")}.`);
    }
    if (capability.moduleOwnership.length === 0 || capability.moduleOwnership.some((ownership) => ownership.specifierPrefix.length === 0)) {
      throw new Error(`Capability '${capability.id}' declares empty module ownership.`);
    }
    for (const ownership of capability.moduleOwnership) {
      const conflict = [...owners.entries()].find(([prefix, ownerId]) =>
        ownerId !== capability.id && ownershipPrefixesOverlap(prefix, ownership.specifierPrefix));
      if (conflict !== undefined) {
        throw new Error(
          `Ambiguous Tsonic capability ownership for target '${targetId}' and module prefixes '${conflict[0]}' and '${ownership.specifierPrefix}': '${conflict[1]}' and '${capability.id}'.`,
        );
      }
      owners.set(ownership.specifierPrefix, capability.id);
    }
    capabilities.push(capability);
  }
  return { capabilities };
}

function ownershipPrefixesOverlap(left: string, right: string): boolean {
  return moduleMatchesPrefix(left, right) || moduleMatchesPrefix(right, left);
}

function moduleMatchesPrefix(moduleSpecifier: string, prefix: string): boolean {
  return moduleSpecifier === prefix || moduleSpecifier.startsWith(`${prefix}/`) ||
    (/[:/]$/u.test(prefix) && moduleSpecifier.startsWith(prefix));
}
