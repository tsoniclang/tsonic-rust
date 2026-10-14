import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFamily } from "../../../../dist/analysis/program/records/family.js";

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
    assert.deepEqual(Object.keys(family.reader), ["get"]);
    assert.deepEqual(Object.keys(family.writer), ["get", "set"]);
    assert.equal(family.reader.get === family.writer.get, true);
    assert.equal(family.reader.get({}) === undefined, true);
    assert.equal(family.reader.get(undefined) === undefined, true);
  }
  assert.equal(first.reader.get(subject), 1);
  assert.equal(second.reader.get(subject), 2);
});

test("record admission preserves false, zero and empty strings without losing exact subjects", () => {
  for (const value of [false, 0, ""]) {
    const family = createRustRecordFamily({ id: "scalar", equals: equal }, open);
    const subject = {};
    family.writer.set(subject, value);
    family.writer.set(subject, value);
    assert.equal(family.reader.get(subject) === value, true, typeof value);
    assert.equal(family.reader.get({}) === undefined, true, typeof value);
  }
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
  family.writer.set(subject, { ...original });
  assert.equal(family.reader.get(subject) === original, true);
  for (const changed of [{ ...original, value: 2 }, { ...original, provenance: {} }]) {
    assert.throws(() => family.writer.set(subject, changed), /Conflicting Rust semantic plan 'provenance'/u);
    assert.equal(family.reader.get(subject) === original, true);
  }
  assert.equal(admissions, 2, "only successful original and equivalent admissions run accounting");
});

test("inherited records remain live, equal admissions do not shadow and new scopes stay isolated", () => {
  const parent = createRustRecordFamily({ id: "scope", equals: equal }, open);
  const child = createRustRecordFamily({ id: "scope", equals: equal }, open, parent.reader);
  const subject = {};
  const childSubject = {};
  parent.writer.set(subject, false);
  child.writer.set(subject, false);
  assert.equal(child.reader.get(subject), false);
  assert.throws(() => child.writer.set(subject, true), /Conflicting Rust semantic plan/u);
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
  for (const target of [subject, {}]) assert.throws(() => family.writer.set(target, false), /owner sealed/u);
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
    family.writer.set(subject, index);
    for (let read = 0; read < 4; read += 1) assert.equal(family.reader.get(subject), index);
  }
  assert.equal(guards, subjects.length * 2);
  assert.equal(comparisons, subjects.length);
  assert.equal(admissions, subjects.length * 2);
});
