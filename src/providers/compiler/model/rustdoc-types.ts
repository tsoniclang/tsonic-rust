export {
  canonicalCompilerTypePathKey,
  canonicalPathKey,
  mergeTypeParameterRequirements,
  normalizeGenericParameters,
  normalizeLifetimeBinder,
  normalizeTypeBounds,
  normalizeTraitDispatch,
  normalizeTraitBounds,
  sourceVisibleTypeParameterCount,
  standardTypePathKind,
} from "./types/normalization.js";
export {
  compilerTypeRequirementConditions,
  compilerTypeSupportsRequirement,
  directImplementationGenericParameterPositions,
  directImplementationTypeParameterPositions,
  normalizeTypeTraits,
  typeParameterGuaranteesRequirement,
} from "./types/requirements.js";
export {
  createRustCompilerSubstitutions,
  emptyRustCompilerSubstitutions,
  normalizeType,
  rustCompilerLifetimeSemanticKey,
  rustCompilerTraitSemanticKey,
  rustCompilerTypeSemanticKey,
  rustStaticValueCanBeCopied,
  substituteRustCompilerArgument,
  substituteRustCompilerTrait,
  substituteRustCompilerType,
  typeRequirementKey,
  type RustCompilerSubstitutions,
} from "./types/substitution.js";
export {
  childNormalizationContext,
  contextWithParameters,
  derivedNormalizationContext,
  rootNormalizationContext,
  rustCompilerDerivedIdentity,
  rustCompilerItemIdentity,
  type RustCompilerNormalizationContext,
} from "./types/normalization-context.js";
