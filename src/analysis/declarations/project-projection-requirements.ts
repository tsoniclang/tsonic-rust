import type { RustProjectTypePolicy } from "../../policy/types/project-types.js";
import { hasRustProjectProjection, selectRustProjectProjectionImplementation,
  type RustProjectProjectionImplementation } from "../../policy/types/project-projections.js";
import type { RustProjectProjectionRequirement } from "../../target-model/types/project-projections.js";
import type { RustProjectTypeDefinition } from "../../policy/types/project-types.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function createRustProjectProjectionRequirementCollector(
  declared: ReadonlySet<string>, projectTypes: RustProjectTypePolicy,
): {
  require(requirement: RustProjectProjectionRequirement): boolean;
  seal(): readonly RustProjectProjectionRequirement[];
} {
  const entries: RustProjectProjectionRequirement[] = [];
  return {
    require(requirement) {
      const parameters = [...rustTargetTypeParameterNames(requirement.sourceCarrier),
        ...rustTargetTypeParameterNames(requirement.targetCarrier)];
      if (!parameters.every(name => declared.has(name)) ||
        !hasRustProjectProjection(requirement.sourceCarrier, requirement.targetCarrier, projectTypes)) return false;
      if (!entries.some(entry =>
        rustTargetTypeRefEquals(entry.sourceCarrier, requirement.sourceCarrier) &&
        rustTargetTypeRefEquals(entry.targetCarrier, requirement.targetCarrier))) entries.push(Object.freeze({ ...requirement }));
      return true;
    },
    seal: () => Object.freeze([...entries]),
  };
}

export function createRustProjectProjectionImplementationIndex(
  requirements: readonly RustProjectProjectionRequirement[], projectTypes: RustProjectTypePolicy,
): (definition: RustProjectTypeDefinition) => readonly RustProjectProjectionImplementation[] {
  const entries = new Map<RustProjectTypeDefinition, RustProjectProjectionImplementation[]>();
  for (const requirement of requirements) {
    const source = projectTypes.definitionForCarrier(requirement.sourceCarrier);
    if (source === undefined) throw new Error("A finalized projection has no source definition.");
    const selected = projectTypes.downcastRoute(source, requirement.targetCarrier);
    if (selected?.kind === "checked") {
      const targetCarrier = projectTypes.openCarrier(selected.target);
      const relation = projectTypes.relationship(targetCarrier, source);
      const route = projectTypes.downcastRoute(source, targetCarrier);
      if (relation.kind !== "related" || route?.kind !== "checked") {
        throw new Error("A checked nominal projection lost its generic native relationship.");
      }
      const implementations = entries.get(selected.target) ?? [];
      if (!implementations.some(implementation => implementation.route.source === source &&
        rustTargetTypeRefEquals(implementation.route.targetCarrier, targetCarrier))) {
        implementations.push(Object.freeze({ route, sourceCarrier: relation.targetType,
          genericOwner: selected.target }));
      }
      entries.set(selected.target, implementations);
      continue;
    }
    const implementations = entries.get(source) ?? [];
    for (const route of projectTypes.downcastRoutesFor(source)) {
      if (implementations.some(implementation => implementation.route === route)) continue;
      const implementation = selectRustProjectProjectionImplementation(requirement, route, projectTypes);
      if (implementation !== undefined) implementations.push(implementation);
    }
    entries.set(source, implementations);
  }
  const sealed = new Map([...entries].map(([source, implementations]) => [source, Object.freeze(implementations)]));
  const genericImplementations = [...entries.values()].flat().filter(implementation => implementation.genericOwner !== undefined);
  for (const [owner, implementations] of sealed) {
    sealed.set(owner, Object.freeze(implementations.filter(implementation => implementation.genericOwner !== undefined ||
      !genericImplementations.some(generic => generic.route.source === implementation.route.source &&
        generic.route.target === implementation.route.target))));
  }
  const empty = Object.freeze([]);
  return definition => sealed.get(definition) ?? empty;
}
