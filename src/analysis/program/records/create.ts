import { assertRustRequiredRecords, type RustRequiredRecord } from "./objects/required-records.js";
import type { RustProgramRecordBuilder } from "./model.js";
import type { RustAnalysisRecords } from "../../../target-model/records/analysis.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { maximumRustFoundation, type RustFoundation } from "../../../target-model/foundation/model.js";

import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { createRustSourceRecordProducers } from "./program/source-producers.js";
import { createRustEmissionRecordProducers } from "./program/emission-producers.js";

export function createRustProgramRecordBuilder(
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions, parent?: RustAnalysisRecords,
): RustProgramRecordBuilder {
  let sealed = false;
  let minimumFoundation: RustFoundation = "core";
  const assertOpen = (): void => {
    if (sealed) failTargetAnalysisInvariant("tsonic-rust", "Rust semantic plans cannot be written after analysis is sealed.");
  };
  const requireFoundation = (foundation: RustFoundation): void => {
    minimumFoundation = maximumRustFoundation(minimumFoundation, foundation);
  };
  const source = createRustSourceRecordProducers(assertOpen, requireFoundation, definitions, parent);
  const emission = createRustEmissionRecordProducers(assertOpen);
  const records: RustAnalysisRecords = Object.freeze({ ...source.readers, ...emission.readers });
  return Object.freeze({
    ...records, ...source.writers, ...emission.writers, assertOpen, readers: records,
    minimumFoundation(): RustFoundation {
      return maximumRustFoundation(minimumFoundation, source.writers.selectedOperations.minimumFoundation());
    },
    seal(required: readonly RustRequiredRecord[]): RustAnalysisRecords {
      if (sealed) failTargetAnalysisInvariant("tsonic-rust", "Rust semantic plans can be sealed only once.");
      assertRustRequiredRecords(records, required);
      source.writers.selectedOperations.seal();
      sealed = true;
      return records;
    },
  });
}

export function createRustProgramRecords(records: RustAnalysisRecords): RustProgramRecords {
  const { memoryBindingPlan, rawLocationPlan, rawAddressPlan, memoryLayoutObservation, typedLocationPlan, ...published } = records;
  return Object.freeze(published);
}
