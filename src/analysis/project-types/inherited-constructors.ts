import type { RustProjectTypePolicy, RustProjectTypeDefinition, RustProjectConstructorSignature } from "../../target-model/types/project-types.js";
export function rustInheritedProjectConstructor(
  policy: RustProjectTypePolicy,
  definition: RustProjectTypeDefinition,
  signature: RustProjectConstructorSignature,
): {
  readonly base: RustProjectTypeDefinition;
  readonly constructor: RustProjectConstructorSignature;
} | undefined {
  if (!signature.implicit) {
    return undefined;
  }
  const baseEdges = policy.heritageForDefinition(definition).filter((edge) =>
    edge.kind === "extends" && edge.target.kind === "class");
  if (baseEdges.length !== 1) {
    return undefined;
  }
  const base = baseEdges[0]!.target;
  const matches = policy.constructorsForDefinition(base).filter((candidate) =>
    candidate.parameters.length === signature.parameters.length &&
    candidate.parameters.every((parameter, index) => {
      const selected = signature.parameters[index];
      return selected !== undefined &&
        parameter.parameterDeclaration === selected.parameterDeclaration &&
        parameter.acceptsOmission === selected.acceptsOmission &&
        parameter.rest === selected.rest;
    }));
  return matches.length === 1 ? { base, constructor: matches[0]! } : undefined;
}
