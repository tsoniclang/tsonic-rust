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
): RustCapabilityCompositionResult {
  const owners = new Map<string, string>();
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
    if (capability.moduleOwnership.length === 0 || capability.moduleOwnership.some((ownership) => ownership.specifierPrefix.length === 0)) {
      throw new Error(`Capability '${capability.id}' declares empty module ownership.`);
    }
    for (const ownership of capability.moduleOwnership) {
      const existing = owners.get(ownership.specifierPrefix);
      if (existing !== undefined) {
        throw new Error(
          `Ambiguous Tsonic capability ownership for target '${targetId}' and module prefix '${ownership.specifierPrefix}': '${existing}' and '${capability.id}'.`,
        );
      }
      owners.set(ownership.specifierPrefix, capability.id);
    }
    capabilities.push(capability);
  }
  return { capabilities };
}
