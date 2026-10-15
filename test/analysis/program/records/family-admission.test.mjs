import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFamily } from "../../../../dist/analysis/program/records/family.js";

for (const method of ["admit", "set"]) {
  for (const equal of [false, true]) {
    test(`${method} refuses ${equal ? "equal" : "unequal"} second local admission before comparison or accounting`, () => {
      let comparisons = 0;
      let admissions = 0;
      const family = createRustRecordFamily({ id: "test.once", equals(left, right) {
        comparisons++;
        return left.value === right.value;
      } }, () => {}, undefined, () => { admissions++; });
      const subject = {};
      const original = { value: 1 };
      const admit = value => method === "admit" ? family.admit(subject, value) : family.writer.set(subject, value);
      admit(original);
      assert.throws(() => admit({ value: equal ? 1 : 2 }), /Duplicate Rust semantic plan 'test.once'/u);
      assert.equal(comparisons, 0, "local duplicate detection does not inspect incoming metadata");
      assert.equal(admissions, 1, "a duplicate cannot repeat native foundation accounting");
      assert.equal(family.reader.get(subject) === original, true);
    });
  }

  test(`${method} retains and accounts a first inherited canonical match once`, () => {
    const subject = {};
    const canonical = { value: 1 };
    let inheritedReads = 0;
    let comparisons = 0;
    let admissions = 0;
    const family = createRustRecordFamily({ id: "test.inherited", equals(left, right) {
      comparisons++;
      return left.value === right.value;
    } }, () => {}, { get(node) {
      inheritedReads++;
      assert.equal(node === subject, true);
      return canonical;
    } }, value => { assert.equal(value === canonical, true); admissions++; });
    const admit = value => method === "admit" ? family.admit(subject, value) : family.writer.set(subject, value);
    admit({ value: 1 });
    assert.equal(family.reader.get(subject) === canonical, true);
    assert.equal(inheritedReads, 1, "the canonical match is now locally owned");
    assert.throws(() => admit(new Proxy({}, { get() { assert.fail("duplicate metadata must stay unread"); } })),
      /Duplicate Rust semantic plan/u);
    assert.deepEqual([inheritedReads, comparisons, admissions], [1, 1, 1]);
  });

  test(`${method} retries failed inherited accounting without marking a local admission`, () => {
    const subject = {};
    const canonical = { value: 1 };
    let inheritedReads = 0;
    let comparisons = 0;
    let attempts = 0;
    let successful = 0;
    let refuse = true;
    const family = createRustRecordFamily({ id: "test.inherited-accounting", equals(left, right) {
      comparisons++;
      return left.value === right.value;
    } }, () => {}, { get(node) {
      inheritedReads++;
      assert.equal(node === subject, true);
      return canonical;
    } }, value => {
      attempts++;
      assert.equal(value === canonical, true, "accounting receives the inherited canonical object");
      if (refuse) throw new Error("inherited accounting refused");
      successful++;
    });
    const admit = value => method === "admit" ? family.admit(subject, value) : family.writer.set(subject, value);
    assert.throws(() => admit({ value: 1 }), /inherited accounting refused/u);
    assert.deepEqual([inheritedReads, comparisons, attempts, successful], [1, 1, 1, 0]);
    assert.equal(family.reader.get(subject) === canonical, true, "failed accounting leaves inheritance readable");
    assert.equal(inheritedReads, 2, "the failed attempt did not mark a local admission");
    refuse = false;
    assert.equal(admit({ value: 1 }) === undefined, true);
    assert.equal(family.reader.get(subject) === canonical, true);
    assert.deepEqual([inheritedReads, comparisons, attempts, successful], [3, 2, 2, 1]);
    for (const value of [{ value: 1 }, { value: 2 }]) {
      assert.throws(() => admit(value), /Duplicate Rust semantic plan 'test.inherited-accounting'/u);
    }
    assert.deepEqual([inheritedReads, comparisons, attempts, successful], [3, 2, 2, 1]);
    assert.equal(family.reader.get(subject) === canonical, true);
  });
}

test("a first inherited conflict is typed, uncharged and retryable with complete matching data", () => {
  const subject = {};
  const canonical = { value: 1 };
  let admissions = 0;
  const family = createRustRecordFamily({ id: "test.retry", equals: (left, right) => left.value === right.value },
    () => {}, { get: () => canonical }, () => { admissions++; });
  const incoming = { value: 2 };
  const conflict = family.admit(subject, incoming);
  assert.equal(conflict.existing === canonical && conflict.incoming === incoming, true);
  assert.equal(admissions, 0);
  assert.equal(family.admit(subject, { value: 1 }) === undefined, true);
  assert.equal(admissions, 1);
  assert.equal(family.reader.get(subject) === canonical, true);
  assert.throws(() => family.writer.set(subject, incoming), /Duplicate Rust semantic plan/u);
});

test("failed accounting leaves no local admission and a successful retry closes it exactly once", () => {
  const subject = {};
  const value = { value: 1 };
  let reject = true;
  let successful = 0;
  const family = createRustRecordFamily({ id: "test.accounting", equals: (left, right) => left.value === right.value },
    () => {}, undefined, () => {
      if (reject) throw new Error("accounting refused");
      successful++;
    });
  assert.throws(() => family.writer.set(subject, value), /accounting refused/u);
  assert.equal(family.reader.get(subject) === undefined, true);
  reject = false;
  family.writer.set(subject, value);
  assert.equal(family.reader.get(subject) === value, true);
  assert.throws(() => family.writer.set(subject, value), /Duplicate Rust semantic plan/u);
  assert.equal(successful, 1);
});

test("a closed family refuses before inherited lookup, comparison or accounting", () => {
  const family = createRustRecordFamily({ id: "test.closed", equals() { assert.fail("closed comparison"); } },
    () => { throw new Error("closed before inspection"); }, { get() { assert.fail("closed inherited lookup"); } },
    () => { assert.fail("closed accounting"); });
  assert.throws(() => family.admit({}, {}), /closed before inspection/u);
  assert.throws(() => family.writer.set({}, {}), /closed before inspection/u);
});
