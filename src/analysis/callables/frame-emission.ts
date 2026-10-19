import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustFrameEmissionProducer } from "../program/records/frame-emission.js";
import type { RustGenericRequirement } from "../../target-model/records/generic-requirements.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import type { RustFrameCallableDefinition } from "../../target-model/records/frame-callables.js";

export function analyzeRustFrameEmission(input: {
  readonly program: Omit<RustTargetProgram, "reachability">;
  readonly sourceFiles: readonly SourceFile[];
  readonly producer: RustFrameEmissionProducer;
}): void {
  const { program } = input;
  const frames = program.callableValues.frames;
  const scopes = new Map<Node, RustFrameCallableDefinition[]>();
  const implementationDeclarations = new Set<Node>();
  for (const [subject, value] of frames.activationInputs) input.producer.input(subject, value);
  for (const [subject, owner] of frames.receiverOwners) input.producer.receiver(subject, owner);
  for (const definition of frames.definitions) {
    if (definition.activation.kind === "lexical") {
      const existing = scopes.get(definition.activation.activationScope) ?? [];
      existing.push(definition);
      scopes.set(definition.activation.activationScope, existing);
    }
    for (const binding of definition.bindings) input.producer.binding(binding, {
      copy: binding.entry?.copy === true || binding.entry === undefined && isRustCopyCarrier(binding.carrier,
        selected => program.callableValues.generic.definitionFor(selected)?.copy === true),
      checkedWrite: program.frozenDataWrites.receiverForDeclaration(binding.declaration) !== undefined,
    });
    const implementations = definition.entries.flatMap(entry => entry.implementations);
    for (const implementation of implementations) implementationDeclarations.add(implementation.declaration);
    const contracts = implementations.map(implementation => {
      const contract = program.declarationGenericRequirements.contractFor(implementation.declaration);
      if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native frame requires its complete generic requirement contracts.", implementation.declaration);
      return contract;
    });
    const parameters = definition.environmentParameters.map(parameter => {
      const requirements = new Set<RustGenericRequirement>();
      for (const contract of contracts) for (const selected of [...contract.typeParameters, ...contract.capturedTypeParameters]) {
        if (selected.identity === parameter.identity) for (const requirement of selected.requirements) requirements.add(requirement);
      }
      return Object.freeze({ identity: parameter.identity, name: parameter.name, requirements: Object.freeze([...requirements]) });
    });
    const associated = new Map(contracts.flatMap(contract => contract.associatedTypes).map(requirement => [closedMetadataKey(requirement), requirement]));
    const projections = new Map(contracts.flatMap(contract => contract.projectProjections).map(requirement => [closedMetadataKey(requirement), requirement]));
    input.producer.definition(definition, { counterName: frames.counterNameFor(definition), parameters: Object.freeze(parameters),
      associated: Object.freeze([...associated.values()]), projections: Object.freeze([...projections.values()]),
      payloads: new Map(implementations.map(implementation => [implementation,
        implementation.captures.length !== 0 || implementation.receiverFields.length !== 0 || implementation.receivers.length !== 0 || definition.environmentParameters.length !== 0])),
    });
  }
  for (const [scope, definitions] of scopes) input.producer.scope(scope, definitions);
  for (const declaration of implementationDeclarations) {
    const selected = frames.implementationFor(declaration);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native frame implementation requires its canonical admitted declaration.", declaration);
    input.producer.implementation(declaration, selected);
  }
  for (const sourceFile of input.sourceFiles) input.producer.sourceFile(sourceFile,
    frames.definitions.filter(definition => definition.ownerFileName === program.source.ast.getFileName(sourceFile)));
}
