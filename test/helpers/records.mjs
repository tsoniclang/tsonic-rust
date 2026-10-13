import { createRustProgramRecordBuilder } from "../../dist/analysis/program/records/create.js";

export function createRustRecordFixture(overrides = {}) {
  const records = createRustProgramRecordBuilder().seal();
  for (const family of Object.keys(overrides)) {
    if (!Object.hasOwn(records, family)) throw new Error("Unknown Rust record family: " + family);
  }
  return Object.freeze({
    ...records,
    ...overrides,
  });
}
