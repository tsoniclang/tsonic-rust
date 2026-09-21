import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustDeclarationGenericRequirementContract, RustGenericRequirement } from "./generic-requirements.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustSourceTypeFamilyRegistry } from "../../policy/types/type-families.js";
import type { Node } from "@tsonic/tsts";
import { createRustAssociatedRequirementCollector } from "./associated-requirements.js";
import { classifyCarrierRequirements } from "./generic-carrier-requirements.js";
import { rustTargetTypeParameterNames } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { emptyRustTypeDefinitions, rustSourceUnionDefinitionIdentity, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";

export type RustShapeGenericRequirementContract = Omit<RustDeclarationGenericRequirementContract, "declaration">;

export function analyzeRustShapeGenericRequirements(
  carrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
  families: RustSourceTypeFamilyRegistry,
  contractFor: (declaration: Node) => RustDeclarationGenericRequirementContract | undefined,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustShapeGenericRequirementContract | undefined {
  const names = rustTargetTypeParameterNames(carrier);
  const declared = new Set(names);
  const parameters = new Map(names.map(name => [name, new Set<RustGenericRequirement>()] as const));
  const classify = (type: TargetTypeRef, requirements: readonly RustGenericRequirement[]): boolean =>
    classifyCarrierRequirements(type, requirements, declared, parameters, associated.require, definitions);
  const associated = createRustAssociatedRequirementCollector(declared, families, classify);
  const activeUnions = new Map<string, string>();
  const visit = (type: TargetTypeRef): boolean => {
    if (!associated.collect(type)) return false;
    const unionIdentity = rustSourceUnionDefinitionIdentity(type);
    if (unionIdentity !== undefined) {
      const key = closedMetadataKey(type);
      if (activeUnions.has(unionIdentity)) return activeUnions.get(unionIdentity) === key;
      const variants = definitions.sourceUnionVariants(type);
      if (variants === undefined) return false;
      activeUnions.set(unionIdentity, key);
      try { return variants.every(variant => visit(variant.carrier)); }
      finally { activeUnions.delete(unionIdentity); }
    }
    const source = rustSourceTypeCarrierValue(type);
    const definition = source === undefined ? undefined : projectTypes.definitionForCarrier(type);
    if (definition !== undefined) {
      const contract = contractFor(definition.declaration);
      if (contract === undefined || source!.genericArguments.length !== definition.genericParameters.length) return false;
      const substitutions = new Map<string, TargetTypeRef>();
      for (const [index, parameter] of definition.genericParameters.entries()) {
        const argument = source!.genericArguments[index];
        if (parameter.kind !== argument?.kind) return false;
        if (parameter.kind !== "type" || argument.kind !== "type") continue;
        const requirement = contract.typeParameters.find(entry => entry.name === parameter.targetName);
        if (requirement === undefined || !classify(argument.type, requirement.requirements)) return false;
        substitutions.set(parameter.targetName, argument.type);
      }
      for (const requirement of contract.associatedTypes) {
        const projection = substituteRustTargetTypeParameters(requirement.carrier, substitutions);
        if (!associated.collect(projection) || !classify(projection, requirement.requirements)) return false;
        if (requirement.fieldAccess !== undefined && (projection.kind !== "associated-type" ||
          !associated.requireField(projection, requirement.fieldAccess))) return false;
      }
    }
    return rustTargetTypeChildren(type).every(visit);
  };
  if (!visit(carrier)) return undefined;
  return Object.freeze({
    typeParameters: Object.freeze(names.map(name => Object.freeze({ name,
      requirements: Object.freeze([...parameters.get(name)!].sort()) }))),
    associatedTypes: associated.seal(),
  });
}
