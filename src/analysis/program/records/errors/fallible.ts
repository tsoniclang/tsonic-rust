import type { ExtensionFactSubject } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustFallibleProducer {
  readonly records: RustRecordFamily<{ readonly fallible: true }>;
  selected(subject: ExtensionFactSubject): void;
}

export function createRustFallibleProducer(
  assertOpen: () => void,
  inherited?: RustFallibleProducer["records"],
): RustFallibleProducer {
  const family = createRustRecordFamily<{ readonly fallible: true }>({
    id: "tsonic.rust.fallible", equals: () => true,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    selected(subject: ExtensionFactSubject): void {
      family.writer.set(subject, { fallible: true });
    },
  });
}
