export {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  mergeTypeParameterRequirements,
  normalizeTraitDispatch,
  normalizeTypeParameters,
  normalizeTypeParameterShape,
  sourceVisibleTypeParameterCount,
  standardTypePathKind,
} from "./types/normalization.js";
export {
  compilerTypeRequirementConditions,
  compilerTypeSupportsRequirement,
  directImplementationTypeParameterPositions,
  normalizeTypeTraits,
  typeParameterGuaranteesRequirement,
} from "./types/requirements.js";
export {
  normalizeType,
  rustStaticValueCanBeCopied,
  substituteRustCompilerType,
  typeRequirementKey,
} from "./types/substitution.js";
