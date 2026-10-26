import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectGenericEmission } from "../../target-model/records/project-emission.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../target-model/types/index.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";

export interface RustProjectGenericMembership {
  readonly parameters: RustProjectGenericEmission["parameters"];
  readonly optionalStorage: RustProjectGenericEmission["optionalStorage"];
  inScope(carrier: TargetTypeRef): boolean;
}

export function prepareRustProjectGenericMembership(
  requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
): { readonly forDeclaration: (definition: RustProjectTypeDefinition,
  indexes: readonly number[]) => RustProjectGenericMembership } {
  const declarations = new Map<RustProjectTypeDefinition, Map<string, RustProjectGenericMembership>>();
  return Object.freeze({ forDeclaration(definition: RustProjectTypeDefinition,
    indexes: readonly number[]): RustProjectGenericMembership {
    const key = JSON.stringify(indexes);
    const selections = declarations.get(definition) ?? new Map<string, RustProjectGenericMembership>();
    const existing = selections.get(key);
    if (existing !== undefined) return existing;
    const source = requirements.contractFor(definition.declaration);
    if (source === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native project definition requires its complete generic contract.", definition.declaration);
    const parameters = indexes.map(index => definition.genericParameters[index] ??
      failTargetAnalysisInvariant("tsonic-rust", "A selected native generic parameter is outside its declaration.", definition.declaration));
    const identities = new Set(parameters.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : []));
    const lifetimes = new Set(parameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
    const inScope = (carrier: TargetTypeRef): boolean => {
      const references = rustTargetGenericReferences(carrier);
      return references.typeIdentities.every(identity => identities.has(identity)) &&
        references.lifetimes.every(lifetime => lifetime.kind === "bound" || lifetimes.has(rustLifetimeKey(lifetime)));
    };
    const selected = Object.freeze({ parameters: Object.freeze(parameters.map(parameter => {
      const contract = parameter.kind === "type" ? source.typeParameters.find(candidate => candidate.identity === parameter.identity) : undefined;
      if (parameter.kind === "type" && contract === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "A source class generic parameter lost its selected requirements.", parameter.declaration);
      return Object.freeze({ parameter, requirements: contract?.requirements ?? Object.freeze([]) });
    })), optionalStorage: Object.freeze(source.optionalStorage.filter(entry => !entry.captured && inScope(entry.carrier))), inScope });
    selections.set(key, selected);
    declarations.set(definition, selections);
    return selected;
  } });
}
