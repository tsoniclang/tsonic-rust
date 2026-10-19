import type { SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFrameDefinitionEmission, RustFrameEmissionRecords } from "../../../target-model/records/frame-emission.js";
import type { RustFrameCallableDefinition } from "../../../target-model/records/frame-callables.js";

export interface RustFrameEmissionProducer {
  readonly records: RustFrameEmissionRecords;
  definition(subject: RustFrameCallableDefinition, value: RustFrameDefinitionEmission): void;
  sourceFile(subject: SourceFile, values: readonly RustFrameCallableDefinition[]): void;
}

export function createRustFrameEmissionProducer(assertOpen: () => void): RustFrameEmissionProducer {
  const definitions = new WeakMap<RustFrameCallableDefinition, RustFrameDefinitionEmission>();
  const sources = new WeakMap<SourceFile, readonly RustFrameCallableDefinition[]>();
  return Object.freeze({ records: Object.freeze({
    frameDeclaration: Object.freeze({ get: (subject: RustFrameCallableDefinition) => definitions.get(subject) }),
    frameDeclarations: Object.freeze({ get: (subject: SourceFile) => sources.get(subject) }),
  }),
    definition(subject: RustFrameCallableDefinition, value: RustFrameDefinitionEmission): void {
      assertOpen();
      if (definitions.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame emission is written exactly once.");
      definitions.set(subject, Object.freeze(value));
    },
    sourceFile(subject: SourceFile, values: readonly RustFrameCallableDefinition[]): void {
      assertOpen();
      if (sources.has(subject)) failTargetAnalysisInvariant("tsonic-rust", "A native frame inventory is written exactly once.", subject);
      sources.set(subject, Object.freeze(values));
    },
  });
}
