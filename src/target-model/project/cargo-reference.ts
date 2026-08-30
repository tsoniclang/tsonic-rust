export const cargoPathReferenceKind = "cargo-path" as const;
export const cargoCrateAttributeName = "crate";
export const cargoRegistryPatchAttributeName = "registryPatch";
export const cargoDefaultFeaturesAttributeName = "defaultFeatures";
export const cargoFeaturesAttributeName = "features";
export const rustMinimumFoundationAttributeName = "minimumFoundation";

export function encodeCargoFeatures(features: readonly string[]): string {
  return JSON.stringify([...new Set(features)].sort((left, right) =>
    left.localeCompare(right, "en")));
}
