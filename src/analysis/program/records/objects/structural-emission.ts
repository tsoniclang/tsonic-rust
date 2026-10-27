import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustStructuralShapeDefinition } from "../../../../target-model/records/objects/structural-shapes.js";
import type { RustStructuralShapeEmission, RustStructuralEmissionRecords } from "../../../../target-model/records/objects/structural-emission.js";

export interface RustStructuralEmissionProducer {
  readonly records: RustStructuralEmissionRecords;
  publish(definition: RustStructuralShapeDefinition, value: RustStructuralShapeEmission): void;
}

export function createRustStructuralEmissionProducer(assertOpen: () => void): RustStructuralEmissionProducer {
  const shapes = new WeakMap<RustStructuralShapeDefinition, RustStructuralShapeEmission>();
  return Object.freeze({ records: Object.freeze({ structuralShapeEmission: Object.freeze({ get: (definition: RustStructuralShapeDefinition) => shapes.get(definition) }) }),
    publish(definition: RustStructuralShapeDefinition, value: RustStructuralShapeEmission): void {
      assertOpen();
      if (shapes.has(definition)) failTargetAnalysisInvariant("tsonic-rust", "A structural declaration has one native emission owner.");
      shapes.set(definition, Object.freeze(value));
    },
  });
}
