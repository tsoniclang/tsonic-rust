import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustLifetimesEqual } from "../../../target-model/lifetimes/index.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustRetainedEnvironment } from "../../../target-model/records/retained-environments.js";
import { createRustRecordFamily } from "./family.js";

export interface RustRetainedEnvironmentProducer {
  readonly records: RustRecordFamily<RustRetainedEnvironment>;
  retain(declaration: Node, lifetime: RustRetainedEnvironment["lifetime"], parameters: readonly Node[]): void;
}

export function createRustRetainedEnvironmentProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustRetainedEnvironment>,
): RustRetainedEnvironmentProducer {
  const corresponds = (existing: RustRetainedEnvironment, lifetime: RustRetainedEnvironment["lifetime"], parameters: readonly Node[]) =>
    rustLifetimesEqual(existing.lifetime, lifetime) && existing.parameters.length === parameters.length &&
    existing.parameters.every((parameter, index) => parameter === parameters[index]);
  const family = createRustRecordFamily<RustRetainedEnvironment>({
    id: "tsonic.rust.retainedEnvironment",
    equals: (left, right) => corresponds(left, right.lifetime, right.parameters),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    retain(declaration: Node, lifetime: RustRetainedEnvironment["lifetime"], parameters: readonly Node[]): void {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (existing !== undefined) {
        if (!corresponds(existing, lifetime, parameters)) failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.retainedEnvironment' for one exact source subject.");
        return;
      }
      family.writer.set(declaration, Object.freeze({ lifetime, parameters: Object.freeze([...parameters]) }));
    },
  });
}
