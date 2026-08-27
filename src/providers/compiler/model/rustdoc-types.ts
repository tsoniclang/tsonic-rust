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
  compilerTypeRequirementCanonicalPath,
  compilerTypeRequirementConditions,
  compilerTypeSupportsRequirement,
  directImplementationGenericParameterPositions,
  directImplementationTypeParameterPositions,
  normalizeTypeTraits,
  typeParameterGuaranteesRequirement,
} from "./types/requirements.js";
export {
  normalizeType,
} from "./types/rustdoc-type-normalization.js";
export {
  createRustCompilerSubstitutions,
  emptyRustCompilerSubstitutions,
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
  rootNormalizationContextForIdentity,
  rustCompilerDerivedIdentity,
  rustCompilerItemIdentity,
  rustCompilerNestedItemIdentity,
  type RustCompilerNormalizationContext,
} from "./types/normalization-context.js";
