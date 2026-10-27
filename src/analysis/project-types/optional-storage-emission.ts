import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectEmissionProducer } from "../program/records/program/project-emission.js";
import type { RustDeclarationGenericRequirementContract } from "../../target-model/records/types/generic-requirements.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceTypeCarrierValue, rustTargetGenericTypeArguments, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";

export function analyzeRustOptionalStorageCallEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: Pick<RustProjectEmissionProducer, "optionalCall">): void {
  for (const node of new Set(nodes)) {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "source-call") continue;
    const declaration = program.records.selectedCall.get(node)?.sourceDeclaration;
    const contract = declaration === undefined ? undefined : program.declarationGenericRequirements.contractFor(declaration);
    if (declaration === undefined || contract === undefined || fact.target.form === "constructor") {
      producer.optionalCall(node, Object.freeze([]));
      continue;
    }
    const arguments_ = rustTargetGenericTypeArguments(fact.targetGenericArguments ?? []);
    const substitutions = new Map(contract.typeParameters.map((parameter, index) => {
      const argument = arguments_[index];
      if (argument === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted source call requires its complete selected native generic arguments.", node);
      return [parameter.identity, argument] as const;
    }));
    producer.optionalCall(node, optionalStorageArgumentsFor(program, contract, substitutions));
  }
}

export function analyzeRustOptionalStorageTypeEmission(program: Omit<RustAnalysisProgram, "reachability">,
  carrier: TargetTypeRef, producer: Pick<RustProjectEmissionProducer, "optionalType">): readonly TargetTypeRef[] {
  const definition = program.projectTypes.definitionForCarrier(carrier);
  if (definition === undefined) {
    const arguments_: readonly TargetTypeRef[] = Object.freeze([]);
    producer.optionalType(carrier, undefined, arguments_);
    return arguments_;
  }
  const source = rustSourceTypeCarrierValue(carrier);
  if (source === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage projection requires its exact class arguments.", definition.declaration);
  const contract = program.declarationGenericRequirements.contractFor(definition.declaration);
  if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage argument set requires its exact declaration contract.", definition.declaration);
  const substitutions = new Map<string, TargetTypeRef>();
  for (const [index, parameter] of definition.genericParameters.entries()) {
    const argument = source.genericArguments[index];
    if (argument?.kind !== parameter.kind) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage projection requires exact generic argument kinds.", definition.declaration);
    if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.identity, argument.type);
  }
  const arguments_ = optionalStorageArgumentsFor(program, contract, substitutions);
  producer.optionalType(carrier, undefined, arguments_);
  const indexes = program.classValues.forDeclaration(definition.declaration)?.environment?.genericParameterIndexes;
  if (indexes !== undefined) {
    const identities = new Set(indexes.flatMap(index => {
      const parameter = definition.genericParameters[index];
      if (parameter === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage projection requires its selected source parameter inventory.", definition.declaration);
      return parameter.kind === "type" ? [parameter.identity] : [];
    }));
    producer.optionalType(carrier, indexes, optionalStorageArgumentsFor(program, contract, substitutions, identities));
  }
  return arguments_;
}

function optionalStorageArgumentsFor(program: Omit<RustAnalysisProgram, "reachability">,
  contract: RustDeclarationGenericRequirementContract, substitutions: ReadonlyMap<string, TargetTypeRef>,
  identities?: ReadonlySet<string>): readonly TargetTypeRef[] {
  return Object.freeze(contract.optionalStorage.filter(entry => !entry.captured && (identities === undefined ||
    rustTargetTypeParameterIdentities(entry.carrier).every(identity => identities.has(identity)))).map(entry =>
    substituteRustTargetGenerics(entry.carrier, substitutions, new Map(), new Map(), program.typeFamilies.normalize)));
}
