import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericRequirement } from "./generic-requirements.js";
import type { RustDeclarationGenericRequirementIndex } from "./generic-requirements.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustOptionalStorageProjection } from "../../target-model/types/projections.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";

export interface RustOptionalStorageRequirement {
  readonly carrier: RustOptionalStorageProjection;
  readonly captured: boolean;
  readonly requirements: readonly RustGenericRequirement[];
}

export interface RustOptionalStorageArgumentInput {
  readonly genericRequirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">;
  readonly projectTypes: Pick<RustProjectTypePolicy, "definitionForCarrier">;
  readonly normalize: (carrier: TargetTypeRef) => TargetTypeRef;
}

export function selectRustOptionalStorageCallArguments(
  declaration: Node,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  input: RustOptionalStorageArgumentInput,
  typeParameterNames?: ReadonlySet<string>,
): readonly RustTargetGenericArgument[] {
  const contract = input.genericRequirements.contractFor(declaration);
  if (contract === undefined) return failTargetAnalysisInvariant("tsonic-rust",
    "A source call lost its sealed generic requirements.", declaration);
  return Object.freeze(contract.optionalStorage.filter(entry => !entry.captured && (typeParameterNames === undefined ||
    rustTargetTypeParameterIdentities(entry.carrier).every(name => typeParameterNames.has(name)))).map(entry => ({
      kind: "type" as const,
      type: substituteRustTargetGenerics(entry.carrier, substitutions, new Map(), new Map(), input.normalize),
    })));
}

export function selectRustOptionalStorageTypeArguments(
  carrier: TargetTypeRef,
  input: RustOptionalStorageArgumentInput,
  parameterIndexes?: readonly number[],
): readonly RustTargetGenericArgument[] {
  const definition = input.projectTypes.definitionForCarrier(carrier);
  if (definition === undefined) return Object.freeze([]);
  const source = rustSourceTypeCarrierValue(carrier);
  if (source === undefined) return failTargetAnalysisInvariant("tsonic-rust",
    "A source storage projection lost its native class arguments.", definition.declaration);
  const substitutions = new Map<string, TargetTypeRef>();
  for (const [index, parameter] of definition.genericParameters.entries()) {
    const argument = source.genericArguments[index];
    if (argument?.kind !== parameter.kind) return failTargetAnalysisInvariant("tsonic-rust",
      "A source storage projection has inconsistent class arity.", definition.declaration);
    if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.identity, argument.type);
  }
  const typeParameterNames = parameterIndexes === undefined ? undefined : new Set(parameterIndexes.flatMap(index => {
    const parameter = definition.genericParameters[index];
    if (parameter === undefined) return failTargetAnalysisInvariant("tsonic-rust",
      "A source storage projection selects an undeclared type parameter.", definition.declaration);
    return parameter.kind === "type" ? [parameter.identity] : [];
  }));
  return selectRustOptionalStorageCallArguments(definition.declaration, substitutions, input, typeParameterNames);
}

export function createRustOptionalStorageCollector(
  own: ReadonlySet<string>,
  declared: Set<string>,
  requirements: Map<string, Set<RustGenericRequirement>>,
): {
  collect(type: TargetTypeRef): boolean;
  seal(): readonly RustOptionalStorageRequirement[];
} {
  const projections = new Map<string, RustOptionalStorageProjection>();
  const collect = (type: TargetTypeRef): boolean => {
    if (type.kind === "type-parameter" && type.optionalStorageValue !== undefined) {
      const names = rustTargetTypeParameterIdentities(type.optionalStorageValue);
      if (names.length === 0 || names.some(name => !declared.has(name))) return false;
      projections.set(type.identity, type as RustOptionalStorageProjection);
      declared.add(type.identity);
      if (!requirements.has(type.identity)) requirements.set(type.identity, new Set());
    }
    return rustTargetTypeChildren(type).every(collect);
  };
  return {
    collect,
    seal: () => Object.freeze([...projections.values()].sort((left, right) => left.name.localeCompare(right.name))
      .map(carrier => Object.freeze({ carrier,
        captured: !rustTargetTypeParameterIdentities(carrier.optionalStorageValue).some(name => own.has(name)),
        requirements: Object.freeze([...(requirements.get(carrier.identity) ?? [])].sort()),
      }))),
  };
}
