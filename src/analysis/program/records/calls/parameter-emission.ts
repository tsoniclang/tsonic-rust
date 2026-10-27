import type { Node } from "@tsonic/tsts";
import type { RustCallableParameterEmission } from "../../../../target-model/records/calls/parameter-emission.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustCallableParameterProducer {
  readonly records: RustRecordFamily<RustCallableParameterEmission>;
  parameter(subject: Node, value: RustCallableParameterEmission): void;
}

export function createRustCallableParameterProducer(assertOpen: () => void): RustCallableParameterProducer {
  const family = createRustRecordFamily<RustCallableParameterEmission>({ id: "tsonic.rust.callableParameter", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    parameter: (subject: Node, value: RustCallableParameterEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
