import { createRustProgramRecordBuilder } from "../../dist/analysis/program/records/create.js";
import assert from "node:assert/strict";

function inheritedRecordFixture(family, subject, fact) {
  assert.equal(fact !== undefined, true, family + ": the actual producer supplied the complete inherited fact");
  const records = createRustRecordFixture({ [family]: { get: candidate => candidate === subject ? fact : undefined } });
  return createRustProgramRecordBuilder(undefined, records);
}

export function assertRustInheritedRecordCorrespondence(family, subject, fact, attempt) {
  const child = inheritedRecordFixture(family, subject, fact);
  attempt(child);
  assert.equal(child[family].get(subject) === fact, true, family + ": equivalent first admission retains canonical inherited evidence");
}

export function assertRustInheritedRecordConflict(family, subject, fact, attempt, diagnostic, label) {
  const child = inheritedRecordFixture(family, subject, fact);
  assert.throws(() => attempt(child), diagnostic, label);
  assert.equal(child[family].get(subject) === fact, true, family + ": failed first correspondence preserves canonical evidence");
}

export function createRustRecordFixture(overrides = {}, base) {
  const raw = createRustProgramRecordBuilder().seal([]);
  const records = base === undefined ? raw : base;
  const families = [...Object.keys(raw), "literalValue"].filter(family => Object.hasOwn(records, family));
  if (families.length === 0) throw new Error("Missing Rust record reader: empty record domain");
  const domain = new Set(families);
  for (const family of Object.keys(overrides)) {
    if (!domain.has(family)) throw new Error("Unknown Rust record family: " + family);
  }
  return Object.freeze(Object.fromEntries(families.map(family => {
    const reader = Object.hasOwn(overrides, family) ? overrides[family] : records[family];
    if (typeof reader?.get !== "function") throw new Error("Missing Rust record reader: " + family);
    return [family, Object.freeze({ get: subject => reader.get(subject) })];
  })));
}
