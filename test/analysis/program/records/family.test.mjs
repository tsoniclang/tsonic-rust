import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFamily } from "../../../../dist/analysis/program/records/family.js";
import { createRustRuntimeCarrierProducer } from "../../../../dist/analysis/program/records/types/runtime-carrier.js";

const equal = (left, right) => left === right;
const open = () => {};

test("typed record families publish one immutable getter and isolate equally named definitions", () => {
  const subject = {};
  const definition = { id: "same-name", equals: equal };
  const first = createRustRecordFamily(definition, open);
  const second = createRustRecordFamily(definition, open);
  first.writer.set(subject, 1);
  second.writer.set(subject, 2);
  for (const family of [first, second]) {
    assert.equal(Object.isFrozen(family), true);
    assert.equal(Object.isFrozen(family.reader), true);
    assert.equal(Object.isFrozen(family.writer), true);
    assert.equal(Object.hasOwn(family, "reuse"), false, "no generic query/publication bypass");
    assert.deepEqual(Object.keys(family.reader), ["get"]);
    assert.deepEqual(Object.keys(family.writer), ["get", "set"]);
    assert.equal(family.reader.get === family.writer.get, true);
    assert.equal(family.reader.get({}) === undefined, true);
    assert.equal(family.reader.get(undefined) === undefined, true);
  }
  assert.equal(first.reader.get(subject), 1);
  assert.equal(second.reader.get(subject), 2);
});

test("record admission preserves null, false, zero and empty strings without losing exact subjects", () => {
  for (const value of [null, false, 0, ""]) {
    const family = createRustRecordFamily({ id: "scalar", equals: equal }, open);
    const subject = {};
    family.writer.set(subject, value);
    assert.throws(() => family.writer.set(subject, value), /Duplicate Rust semantic plan/u);
    assert.equal(family.reader.get(subject) === value, true, typeof value);
    assert.equal(family.reader.get({}) === undefined, true, typeof value);
  }
});

test("an admitted null payload is distinct from missing evidence in inherited scopes", () => {
  const subject = {};
  const parent = createRustRecordFamily({ id: "nullable", equals: equal }, open);
  parent.writer.set(subject, null);
  const child = createRustRecordFamily({ id: "nullable", equals: equal }, open, parent.reader);
  assert.equal(child.reader.get(subject), null);
  child.writer.set(subject, null);
  assert.equal(child.reader.get(subject), null);
  assert.equal(child.reader.get({}), undefined);
  const conflicting = createRustRecordFamily({ id: "nullable", equals: equal }, open, parent.reader);
  assert.throws(() => conflicting.writer.set(subject, false), /Conflicting Rust semantic plan/u);
  assert.equal(conflicting.reader.get(subject), null);
});

test("equivalent admissions retain the first evidence and conflicting provenance is rejected", () => {
  let admissions = 0;
  const subject = {};
  const provenance = {};
  const original = { value: 1, provenance };
  const family = createRustRecordFamily({ id: "provenance", equals: (left, right) =>
    left.value === right.value && left.provenance === right.provenance }, open, undefined, () => {
    admissions += 1;
  });
  family.writer.set(subject, original);
  assert.throws(() => family.writer.set(subject, { ...original }), /Duplicate Rust semantic plan/u);
  assert.equal(family.reader.get(subject) === original, true);
  for (const changed of [{ ...original, value: 2 }, { ...original, provenance: {} }]) {
    const comparison = createRustRecordFamily({ id: "provenance", equals: (left, right) =>
      left.value === right.value && left.provenance === right.provenance }, open, family.reader,
      () => { admissions += 1; });
    assert.throws(() => comparison.writer.set(subject, changed), /Conflicting Rust semantic plan 'provenance'/u);
    assert.equal(comparison.reader.get(subject) === original, true);
    assert.equal(family.reader.get(subject) === original, true);
  }
  assert.equal(admissions, 1, "neither duplicates nor incompatible first inherited requests run accounting");
});

test("inherited records remain live, equal admissions do not shadow and new scopes stay isolated", () => {
  const parent = createRustRecordFamily({ id: "scope", equals: equal }, open);
  const child = createRustRecordFamily({ id: "scope", equals: equal }, open, parent.reader);
  const subject = {};
  const childSubject = {};
  parent.writer.set(subject, false);
  child.writer.set(subject, false);
  assert.equal(child.reader.get(subject), false);
  const incompatible = createRustRecordFamily({ id: "scope", equals: equal }, open, parent.reader);
  assert.throws(() => incompatible.writer.set(subject, true), /Conflicting Rust semantic plan/u);
  assert.throws(() => child.writer.set(subject, true), /Duplicate Rust semantic plan/u);
  child.writer.set(childSubject, true);
  assert.equal(parent.reader.get(childSubject) === undefined, true);
  const laterSubject = {};
  parent.writer.set(laterSubject, true);
  assert.equal(child.reader.get(laterSubject), true, "existing parent records are not snapshotted");
  const grandchild = createRustRecordFamily({ id: "scope", equals: equal }, open, child.reader);
  assert.equal(grandchild.reader.get(childSubject), true);
  assert.equal(grandchild.reader.get(subject), false);
});

test("the owning seal blocks all admissions before reads, equality or foundation accounting", () => {
  let sealed = false;
  let inheritedReads = 0;
  let comparisons = 0;
  let admissions = 0;
  const family = createRustRecordFamily({ id: "closed", equals: () => {
    comparisons += 1;
    return true;
  } }, () => {
    if (sealed) throw new Error("owner sealed");
  }, { get: () => { inheritedReads += 1; return undefined; } }, () => { admissions += 1; });
  const subject = {};
  family.writer.set(subject, false);
  assert.equal(inheritedReads, 1);
  sealed = true;
  for (const publish of [family.writer.set, family.admit]) {
    for (const target of [subject, {}]) assert.throws(() => publish(target, false), /owner sealed/u);
  }
  assert.equal(inheritedReads, 1);
  assert.equal(comparisons, 0);
  assert.equal(admissions, 1);
  assert.equal(family.reader.get(subject), false, "sealing never invalidates a read");
  assert.equal(family.reader.get(undefined) === undefined, true);
  assert.equal(inheritedReads, 1, "missing subjects do not query the parent");
});

test("admission has constant family work and reads never recompute accounting", () => {
  let guards = 0;
  let comparisons = 0;
  let admissions = 0;
  const family = createRustRecordFamily({ id: "finite", equals: (left, right) => {
    comparisons += 1;
    return left === right;
  } }, () => { guards += 1; }, undefined, () => { admissions += 1; });
  const subjects = Array.from({ length: 4096 }, () => ({}));
  for (const [index, subject] of subjects.entries()) {
    family.writer.set(subject, index);
    assert.throws(() => family.writer.set(subject, index), /Duplicate Rust semantic plan/u);
    for (let read = 0; read < 4; read += 1) assert.equal(family.reader.get(subject), index);
  }
  assert.equal(guards, subjects.length * 2);
  assert.equal(comparisons, 0);
  assert.equal(admissions, subjects.length);
});

test("typed conflict outcomes and strict failures share exactly one comparison and admission path", () => {
  let comparisons = 0;
  let admissions = 0;
  let sealed = false;
  const original = { value: 1 };
  const family = createRustRecordFamily({ id: "channels", equals: (left, right) => {
    comparisons += 1;
    return left.value === right.value;
  } }, () => { if (sealed) throw new Error("owner sealed"); }, { get: () => original }, () => { admissions += 1; });
  const subject = {};
  const incoming = { value: 2 };
  const conflict = family.admit(subject, incoming);
  assert.equal(conflict?.existing === original, true);
  assert.equal(conflict?.incoming === incoming, true);
  assert.equal(comparisons, 1);
  assert.equal(admissions, 0, "conflicting admission never accounts");
  assert.equal(family.reader.get(subject) === original, true, "conflict never publishes");
  assert.throws(() => family.writer.set(subject, incoming), /Conflicting Rust semantic plan 'channels'/u);
  assert.equal(comparisons, 2, "strict channel compares exactly once");
  assert.equal(admissions, 0);
  assert.equal(family.admit(subject, { value: 1 }) === undefined, true, "first matching inherited admission has no result object");
  assert.equal(family.reader.get(subject) === original, true);
  assert.equal(comparisons, 3);
  assert.equal(admissions, 1);
  assert.throws(() => family.admit(subject, original), /Duplicate Rust semantic plan/u);
  sealed = true;
  assert.throws(() => family.admit(subject, original), /owner sealed/u);
  assert.throws(() => family.writer.set(subject, original), /owner sealed/u);
  assert.equal(comparisons, 3);
  assert.equal(admissions, 1);
});

test("the source-carrier query validates canonical correspondence without a generic reuse port", () => {
  const subject = {};
  const carrier = { kind: "source-primitive", name: "int32" };
  const inherited = { carrier };
  let admissions = 0;
  let sealed = false;
  let inheritedReads = 0;
  const producer = createRustRuntimeCarrierProducer(() => { if (sealed) throw new Error("owner sealed"); },
    () => { admissions += 1; }, { get(candidate) {
      inheritedReads += 1;
      return candidate === subject ? inherited : undefined;
    } });
  assert.equal(producer.source(subject, { ...carrier }) === undefined, true);
  assert.equal(producer.records.get(subject) === inherited, true);
  assert.equal(admissions, 0, "an inherited source query is not a publication");
  const changed = { kind: "source-primitive", name: "int64" };
  const conflict = producer.source(subject, changed);
  assert.equal(conflict?.existing === inherited, true);
  assert.equal(conflict?.incoming.carrier === changed, true, "the exact incompatible request is retained");
  assert.equal(admissions, 0);
  producer.selected(subject, { ...carrier });
  assert.equal(admissions, 1, "strict equal publication retains accounting");
  const foreign = {};
  assert.equal(producer.source(foreign, changed) === undefined, true);
  const selected = producer.records.get(foreign);
  assert.equal(selected?.carrier === changed, true);
  assert.equal(admissions, 2, "first source selection is a publication");
  assert.equal(producer.source(foreign, { ...changed }) === undefined, true);
  assert.equal(producer.records.get(foreign) === selected, true, "repeat source queries retain the canonical record");
  assert.equal(admissions, 2);
  const readsBeforeSeal = inheritedReads;
  sealed = true;
  assert.throws(() => producer.source(subject, carrier), /owner sealed/u);
  assert.throws(() => producer.source(foreign, changed), /owner sealed/u);
  assert.throws(() => producer.source({}, changed), /owner sealed/u);
  assert.throws(() => producer.selected(subject, carrier), /owner sealed/u);
  assert.equal(admissions, 2);
  assert.equal(inheritedReads, readsBeforeSeal, "the sealed query refuses before any inherited read");
});

test("failed accounting never publishes a partial record and later exact admissions remain retryable", () => {
  let reject = true;
  let admissions = 0;
  const failure = new Error("native foundation admission failed");
  const subject = {};
  const original = Object.freeze({ value: 1 });
  const family = createRustRecordFamily({ id: "atomic", equals: equal }, open, undefined, () => {
    admissions += 1;
    if (reject) throw failure;
  });
  assert.throws(() => family.writer.set(subject, original), caught => caught === failure);
  assert.equal(family.reader.get(subject) === undefined, true, "failed demand cannot leave a finalized record");
  assert.equal(admissions, 1);
  reject = false;
  family.writer.set(subject, original);
  assert.equal(family.reader.get(subject) === original, true, "retry publishes the exact original evidence");
  assert.equal(admissions, 2);
});
