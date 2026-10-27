import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustLifetimesEqual } from "../../../../target-model/lifetimes/index.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustRetainedEnvironment } from "../../../../target-model/records/callables/retained-environments.js";
import { createRustRecordFamily } from "../family.js";

export interface RustRetainedEnvironmentProducer {
  readonly records: RustRecordFamily<RustRetainedEnvironment>;
  retain(declaration: Node, lifetime: RustRetainedEnvironment["lifetime"], inputs: RustRetainedEnvironment["inputs"]): void;
}

export function createRustRetainedEnvironmentProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustRetainedEnvironment>,
): RustRetainedEnvironmentProducer {
  const corresponds = (existing: RustRetainedEnvironment, lifetime: RustRetainedEnvironment["lifetime"], inputs: RustRetainedEnvironment["inputs"]) =>
    rustLifetimesEqual(existing.lifetime, lifetime) && existing.inputs.length === inputs.length &&
    existing.inputs.every((input, index) => {
      const other = inputs[index];
      return other !== undefined && input.kind === other.kind &&
        (input.kind === "native-task-scope" || other.kind === "parameter" && input.declaration === other.declaration);
    });
  const family = createRustRecordFamily<RustRetainedEnvironment>({
    id: "tsonic.rust.retainedEnvironment",
    equals: (left, right) => corresponds(left, right.lifetime, right.inputs),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    retain(declaration: Node, lifetime: RustRetainedEnvironment["lifetime"], inputs: RustRetainedEnvironment["inputs"]): void {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (existing !== undefined) {
        if (!corresponds(existing, lifetime, inputs)) failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.retainedEnvironment' for one exact source subject.");
        return;
      }
      family.writer.set(declaration, Object.freeze({ lifetime, inputs: Object.freeze(inputs.map(input => Object.freeze({ ...input }))) }));
    },
  });
}
