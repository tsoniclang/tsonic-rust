import type { SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustFrameEmissionProducer } from "../program/records/frame-emission.js";
import type { RustGenericRequirement } from "../../target-model/records/generic-requirements.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";

export function analyzeRustFrameEmission(input: {
  readonly program: Omit<RustTargetProgram, "reachability">;
  readonly sourceFiles: readonly SourceFile[];
  readonly producer: RustFrameEmissionProducer;
}): void {
  const { program } = input;
  const frames = program.callableValues.frames;
  for (const definition of frames.definitions) {
    const implementations = definition.entries.flatMap(entry => entry.implementations);
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
  for (const sourceFile of input.sourceFiles) input.producer.sourceFile(sourceFile,
    frames.definitions.filter(definition => definition.ownerFileName === program.source.ast.getFileName(sourceFile)));
}
