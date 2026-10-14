import type { Node } from "@tsonic/tsts";
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
  const family = createRustRecordFamily<RustRetainedEnvironment>({
    id: "tsonic.rust.retainedEnvironment",
    equals: (left, right) => rustLifetimesEqual(left.lifetime, right.lifetime) &&
      left.parameters.length === right.parameters.length &&
      left.parameters.every((parameter, index) => parameter === right.parameters[index]),
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    retain(declaration: Node, lifetime: RustRetainedEnvironment["lifetime"], parameters: readonly Node[]): void {
      family.writer.set(declaration, Object.freeze({ lifetime, parameters: Object.freeze([...parameters]) }));
    },
  });
}
