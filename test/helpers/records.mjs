import { createRustProgramRecordBuilder } from "../../dist/analysis/program/records/create.js";

export function createRustRecordFixture(overrides = {}, base) {
  const records = createRustProgramRecordBuilder().seal();
  for (const family of Object.keys(overrides)) {
    if (!Object.hasOwn(records, family)) throw new Error("Unknown Rust record family: " + family);
  }
  return Object.freeze(Object.fromEntries(Object.keys(records).map(family => {
    const reader = Object.hasOwn(overrides, family) ? overrides[family] : (base === undefined ? records : base)[family];
    if (typeof reader?.get !== "function") throw new Error("Missing Rust record reader: " + family);
    return [family, Object.freeze({ get: subject => reader.get(subject) })];
  })));
}
