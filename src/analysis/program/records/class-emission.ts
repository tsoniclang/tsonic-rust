import type { Node } from "@tsonic/tsts";
import type { RustNativeClassEmission } from "../../../target-model/records/class-emission.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import { createRustRecordFamily } from "./family.js";

export interface RustClassEmissionProducer {
  readonly records: RustRecordFamily<RustNativeClassEmission>;
  classDeclaration(subject: Node, value: RustNativeClassEmission): void;
}

export function createRustClassEmissionProducer(assertOpen: () => void): RustClassEmissionProducer {
  const family = createRustRecordFamily<RustNativeClassEmission>({ id: "tsonic.rust.nativeClass", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: family.reader,
    classDeclaration: (subject: Node, value: RustNativeClassEmission): void => family.writer.set(subject, Object.freeze(value)),
  });
}
