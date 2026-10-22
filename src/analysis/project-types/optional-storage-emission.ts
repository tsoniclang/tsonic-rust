import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectEmissionProducer } from "../program/records/project-emission.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustSourceTypeCarrierValue, rustTargetGenericTypeArguments, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { rustPhysicalEmissionRecordCarriers } from "../callables/emission-contexts.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";

export function analyzeRustOptionalStorageEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustProjectEmissionProducer): void {
  const argumentsFor = (declaration: Node, substitutions: ReadonlyMap<string, TargetTypeRef>, identities?: ReadonlySet<string>): readonly TargetTypeRef[] => {
    const contract = program.declarationGenericRequirements.contractFor(declaration);
    if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage argument set requires its exact declaration contract.", declaration);
    return Object.freeze(contract.optionalStorage.filter(entry => !entry.captured && (identities === undefined ||
      rustTargetTypeParameterIdentities(entry.carrier).every(identity => identities.has(identity)))).map(entry =>
      substituteRustTargetGenerics(entry.carrier, substitutions, new Map(), new Map(), program.typeFamilies.normalize)));
  };
  const pending = nodes.flatMap(node => rustPhysicalEmissionRecordCarriers(program.records, node));
  for (const definition of program.projectTypes.definitions) pending.push(program.projectTypes.openCarrier(definition));
  for (const shape of program.structuralShapes.instances) pending.push(shape.carrier, ...shape.fields.map(field => field.carrier));
  for (const context of program.physicalEmissionContexts.contexts) pending.push(...context.operands);
  for (const operand of program.physicalEmissionContexts.operands) pending.push(operand.carrier,
    ...(operand.destination === undefined ? [] : [operand.destination]));
  const seen = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const carrier = pending[index]!;
    const key = closedMetadataKey(carrier);
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(...rustTargetTypeChildren(carrier));
    // A class constructor value renders its class environment from the instance it constructs.
    const constructed = rustClassConstructorInstance(carrier);
    if (constructed !== undefined) pending.push(constructed);
    const definition = program.projectTypes.definitionForCarrier(carrier);
    if (definition === undefined) { producer.optionalType(carrier, undefined, Object.freeze([])); continue; }
    const source = rustSourceTypeCarrierValue(carrier);
    if (source === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage projection requires its exact class arguments.", definition.declaration);
    const substitutions = new Map<string, TargetTypeRef>();
    for (const [index, parameter] of definition.genericParameters.entries()) {
      const argument = source.genericArguments[index];
      if (argument?.kind !== parameter.kind) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage projection requires exact generic argument kinds.", definition.declaration);
      if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.identity, argument.type);
    }
    producer.optionalType(carrier, undefined, argumentsFor(definition.declaration, substitutions));
    const indexes = program.classValues.forDeclaration(definition.declaration)?.environment?.genericParameterIndexes;
    if (indexes !== undefined) {
      const identities = new Set(indexes.flatMap(index => {
        const parameter = definition.genericParameters[index];
        if (parameter === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted optional storage projection requires its selected source parameter inventory.", definition.declaration);
        return parameter.kind === "type" ? [parameter.identity] : [];
      }));
      producer.optionalType(carrier, indexes, argumentsFor(definition.declaration, substitutions, identities));
    }
  }
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
    producer.optionalCall(node, argumentsFor(declaration, substitutions));
  }
}
