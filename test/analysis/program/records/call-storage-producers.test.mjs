import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustAbsenceTargetType, rustOptionTargetType, rustSourceOptionalTargetType, rustSourceLocationTargetType } from "../../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const conflict = /Conflicting Rust semantic plan/u;
const sealed = /after analysis is sealed/u;
const subject = {};
const pointer = {};
const value = {};
const location = rustSourceLocationTargetType(integer);
const projections = { kind: "tuple-element", index: 0 };
const families = [
  ["argumentPassing", "argumentPassingPlans", owner => owner.pass(subject, "by-value")],
  ["typedLocationPlan", "typedLocations", owner => owner.finalize(subject, integer, location, { operation: "load", pointerExpression: pointer })],
  ["bindingStorage", "bindingStoragePlans", owner => owner.capture(subject, integer, { storage: "location" })],
  ["retainedCallLifetimes", "retainedCalls", owner => owner.finalize(subject, new Map([["region", { kind: "static" }]]))],
  ["bindingProjection", "bindingProjections", owner => owner.resolve([], subject, integer, integer, projections)],
];

test("call/storage families expose exact frozen readers and only their semantic producers", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const records = builder.seal(builderRequiredRecords);
  assert.equal(Object.keys(records).length, 348, "348 sealed analysis record families, including the canonical nativeHandler and nativeTaskUse families");
  for (const [family, producer, attempt] of families) {
    assert.equal(builder[family] === builder[producer].records, true, family);
    assert.equal(records[family] === builder[family], true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(Object.isFrozen(builder[producer]), true, producer);
    assert.equal(Object.isFrozen(records[family]), true, family);
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(records[producer] === undefined, true, producer);
    assert.equal(records[family].get(subject) === undefined, true, family);
    assert.equal(records[family].get(undefined) === undefined, true, family);
    assert.throws(() => attempt(builder[producer]), sealed, producer);
  }
  assert.throws(() => builder.bindingStoragePlans.capture(subject, integer, { storage: "value" }), sealed);
  assert.throws(() => builder.retainedCalls.finalize(subject, new Map()), sealed);
  assert.throws(() => builder.bindingProjections.resolve(builderRequiredRecords, subject, integer, integer, projections, undefined, wide), sealed);
});

for (const mode of ["by-value", "borrow-shared", "borrow-mut"]) {
  test(`argument ${mode} construction preserves the exact subject and inherited first admission`, () => {
    const parent = createRustProgramRecordBuilder();
    const parentRequiredRecords = [];
    parent.argumentPassingPlans.pass(subject, mode);
    const first = parent.argumentPassing.get(subject);
    assert.equal(first?.mode, mode);
    assert.equal(first.storageExpression === subject, mode !== "by-value");
    assert.equal(Object.hasOwn(first, "storageExpression"), mode !== "by-value");
    assert.equal(Object.isFrozen(first), true);
    const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
    const childRequiredRecords = [];
    child.argumentPassingPlans.pass(subject, mode);
    assert.equal(child.argumentPassing.get(subject) === first, true);
    for (const different of ["by-value", "borrow-shared", "borrow-mut"].filter(candidate => candidate !== mode)) {
      assertRustInheritedRecordConflict("argumentPassing", subject, first,
        candidate => candidate.argumentPassingPlans.pass(subject, different), conflict);
      assert.equal(child.argumentPassing.get(subject) === first, true);
    }
    const other = {};
    child.argumentPassingPlans.pass(other, mode);
    assert.equal(parent.argumentPassing.get(other) === undefined, true);
    assert.equal(child.argumentPassing.get(other)?.storageExpression === other, mode !== "by-value");
    assert.equal(child.minimumFoundation(), "core");
  });
}

const operandCases = [
  { operation: "address-of", storageExpression: value, storageDeclaration: {}, rootExpression: {}, rootDeclaration: {}, locationIdentity: {} },
  { operation: "allocate", initialExpression: value, locationIdentity: {} },
  { operation: "load", pointerExpression: pointer },
  { operation: "store", pointerExpression: pointer, valueExpression: value },
  { operation: "equal-pointer", leftExpression: pointer, rightExpression: {} },
  { operation: "hash-pointer", pointerExpression: pointer },
  { operation: "bind-pointer", identityExpression: {}, readExpression: {}, writeExpression: {} },
  { operation: "project-pointer", pointerExpression: pointer, sourcePointeeCarrier: wide, optional: false,
    fromSourceExpression: {}, toSourceExpression: {} },
  { operation: "view-pointer", pointerExpression: pointer, sourcePointeeCarrier: wide, optional: true,
    readExpression: {}, writeExpression: {} },
];

for (const operands of operandCases) {
  test(`typed-location ${operands.operation} owns common construction and all exact operand identities`, () => {
    const parent = createRustProgramRecordBuilder();
    const parentRequiredRecords = [];
    parent.typedLocations.finalize(subject, integer, location, operands);
    const first = parent.typedLocationPlan.get(subject);
    assert.equal(first?.call === subject, true);
    assert.equal(first.pointeeCarrier === integer && first.locationCarrier === location, true);
    for (const [key, selected] of Object.entries(operands)) assert.equal(first[key] === selected, true, key);
    assert.equal(Object.isFrozen(first), true);
    const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
    const childRequiredRecords = [];
    child.typedLocations.finalize(subject, { ...integer }, structuredClone(location), { ...operands });
    assert.equal(child.typedLocationPlan.get(subject) === first, true);
    assertRustInheritedRecordConflict("typedLocationPlan", subject, first,
      candidate => candidate.typedLocations.finalize(subject, wide, location, operands), conflict);
    assertRustInheritedRecordConflict("typedLocationPlan", subject, first,
      candidate => candidate.typedLocations.finalize(subject, integer, rustSourceLocationTargetType(wide), operands), conflict);
    for (const [key, selected] of Object.entries(operands)) {
      if (key === "operation") continue;
      const replacement = key === "optional" ? !selected : key === "sourcePointeeCarrier" ? integer : {};
      assertRustInheritedRecordConflict("typedLocationPlan", subject, first,
        candidate => candidate.typedLocations.finalize(subject, integer, location, { ...operands, [key]: replacement }), conflict, key);
      assert.equal(child.typedLocationPlan.get(subject) === first, true, key);
    }
    const other = {};
    child.typedLocations.finalize(other, integer, location, operands);
    assert.equal(child.typedLocationPlan.get(other)?.call === other, true);
    assert.equal(parent.typedLocationPlan.get(other) === undefined, true);
    assert.equal(child.minimumFoundation(), "core");
  });
}

test("typed-location finalization owns the call and carriers rather than accepting copied common fields", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const extra = { operation: "load", pointerExpression: pointer, call: {}, pointeeCarrier: wide,
    locationCarrier: rustSourceLocationTargetType(wide) };
  builder.typedLocations.finalize(subject, integer, location, extra);
  const fact = builder.typedLocationPlan.get(subject);
  assert.equal(fact?.call === subject, true);
  assert.equal(fact.pointeeCarrier === integer && fact.locationCarrier === location, true);
  assert.equal(fact.pointerExpression === pointer, true);
  assert.equal(builder.typedLocationPlan.get(extra.call) === undefined, true);
});

for (const storage of ["location", "cell", "borrow-cell"]) {
  for (const deferred of storage === "location" ? [false, true] : [false]) {
    test(`captured ${storage}/${deferred ? "deferred" : "ready"} retains the selected physical backing and lexical activation`, () => {
      const parent = createRustProgramRecordBuilder();
      const parentRequiredRecords = [];
      const iterationScope = {};
      const selected = { storage, mutable: true,
        ...(storage === "location" ? { iterationScope } : {}),
        ...(deferred ? { initialization: "deferred" } : {}),
      };
      parent.bindingStoragePlans.capture(subject, integer, selected);
      const first = parent.bindingStorage.get(subject);
      assert.equal(first?.storage, storage);
      assert.equal(first.valueCarrier === integer, true);
      assert.equal(first.iterationScope === iterationScope, storage === "location");
      assert.equal(first.initialization, deferred ? "deferred" : undefined);
      assert.equal(Object.hasOwn(first, "initialization"), deferred);
      assert.equal(Object.hasOwn(first, "mutable"), false, "capture mutability is not a competing storage fact");
      assert.equal(Object.isFrozen(first), true);
      const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
      const childRequiredRecords = [];
      child.bindingStoragePlans.capture(subject, { ...integer }, { ...selected });
      assert.equal(child.bindingStorage.get(subject) === first, true);
      const incompatible = [{ ...selected, storage: storage === "location" ? "cell" : "location" },
        { ...selected, iterationScope: {} }, { ...selected, initialization: deferred ? undefined : "deferred" }];
      if (storage === "location") incompatible.push({ ...selected, iterationScope: undefined });
      for (const changed of incompatible) {
        assertRustInheritedRecordConflict("bindingStorage", subject, first,
          candidate => candidate.bindingStoragePlans.capture(subject, integer, changed), conflict);
      }
      assertRustInheritedRecordConflict("bindingStorage", subject, first,
        candidate => candidate.bindingStoragePlans.capture(subject, wide, selected), conflict);
      const other = {};
      child.bindingStoragePlans.capture(other, integer, { storage: "value", mutable: true });
      assert.equal(child.bindingStorage.get(other) === undefined, true, "a selected inline value does not acquire backing storage");
      child.bindingStoragePlans.capture(other, wide, { storage: "location" });
      assert.equal(child.bindingStorage.get(other)?.storage, "location");
      assert.equal(child.bindingStorage.get(other)?.valueCarrier === wide, true);
      assert.equal(parent.bindingStorage.get(other) === undefined, true);
      assert.equal(child.minimumFoundation(), "core");
    });
  }
}

test("retained calls finalize one frozen ordered lifetime map without inventing empty environments", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const firstLifetime = { kind: "static" };
  const secondLifetime = { kind: "call-scoped-elision", callIdentity: "call:2", parameterIdentity: "parameter:2" };
  parent.retainedCalls.finalize(subject, new Map());
  assert.equal(parent.retainedCallLifetimes.get(subject) === undefined, true);
  const selected = new Map([["first", firstLifetime], ["second", secondLifetime]]);
  parent.retainedCalls.finalize(subject, selected);
  const first = parent.retainedCallLifetimes.get(subject);
  assert.equal(first?.length, 2);
  assert.deepEqual(first.map(entry => entry.identity), ["first", "second"]);
  assert.equal(first[0].lifetime === firstLifetime && first[1].lifetime === secondLifetime, true);
  assert.equal(Object.isFrozen(first) && first.every(Object.isFrozen), true);
  selected.clear();
  assert.equal(first.length, 2, "finalization snapshots the ordered selected substitutions");
  const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
  const childRequiredRecords = [];
  child.retainedCalls.finalize(subject, new Map([["first", { ...firstLifetime }], ["second", { ...secondLifetime }]]));
  assert.equal(child.retainedCallLifetimes.get(subject) === first, true);
  child.retainedCalls.finalize(subject, new Map());
  assert.equal(child.retainedCallLifetimes.get(subject) === first, true, "an empty request never overwrites inherited selection");
  for (const changed of [new Map([["second", secondLifetime], ["first", firstLifetime]]),
    new Map([["first", firstLifetime]]), new Map([["other", firstLifetime], ["second", secondLifetime]]),
    new Map([["first", firstLifetime], ["second", { ...secondLifetime, callIdentity: "another" }]]),
    new Map([["first", firstLifetime], ["second", { ...secondLifetime, parameterIdentity: "another" }]])]) {
    assertRustInheritedRecordConflict("retainedCallLifetimes", subject, first,
      candidate => candidate.retainedCalls.finalize(subject, changed), conflict);
    assert.equal(child.retainedCallLifetimes.get(subject) === first, true);
  }
  const other = {};
  child.retainedCalls.finalize(other, new Map([["first", firstLifetime]]));
  assert.equal(parent.retainedCallLifetimes.get(other) === undefined, true);
  assert.equal(child.minimumFoundation(), "core");
});

for (const [normalization, projected, fallback, checked] of [
  ["identity", integer, undefined, undefined],
  ["default-on-none", rustOptionTargetType(integer), integer, undefined],
  ["default-on-absence", rustAbsenceTargetType(), integer, undefined],
  ["checked-array", rustOptionTargetType(integer), undefined, integer],
  ["checked-array-default", rustOptionTargetType(integer), integer, integer],
]) {
  test(`binding ${normalization} centralizes normalization without losing selected projection data`, () => {
    const parent = createRustProgramRecordBuilder();
    const parentRequiredRecords = [];
    const source = { kind: "tuple", elements: [projected] };
    const first = parent.bindingProjections.resolve(parentRequiredRecords, subject, source, projected, projections, fallback, checked);
    assert.equal(first !== undefined, true);
    assert.equal(parent.bindingProjection.get(subject) === first, true);
    assert.equal(first.sourceCarrier === source && first.projectedCarrier === projected && first.projection === projections, true);
    assert.equal(first.normalization, normalization);
    const storage = checked === undefined ? projected : rustSourceOptionalTargetType(checked);
    assert.equal(rustTargetTypeRefEquals(first.storageCarrier, storage), true);
    assert.equal(rustTargetTypeRefEquals(first.bindingCarrier,
      normalization === "default-on-none" || normalization === "default-on-absence" || normalization === "checked-array-default" ? integer : storage), true);
    assert.equal(Object.isFrozen(first), true);
    const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
    const childRequiredRecords = [];
    child.bindingProjections.resolve(childRequiredRecords, subject, source, projected, { ...projections }, fallback, checked);
    assert.equal(child.bindingProjection.get(subject) === first, true);
    assertRustInheritedRecordConflict("bindingProjection", subject, first,
      candidate => candidate.bindingProjections.resolve([], subject, wide, projected, projections, fallback, checked), conflict);
    assertRustInheritedRecordConflict("bindingProjection", subject, first,
      candidate => candidate.bindingProjections.resolve([], subject, source, projected, { ...projections, index: 1 }, fallback, checked), conflict);
    assert.equal(child.bindingProjections.resolve(childRequiredRecords, {}, source, integer, projections, undefined, wide) === undefined, true,
      "a mismatching checked array premise is rejected before admission");
    const other = {};
    child.bindingProjections.resolve(childRequiredRecords, other, source, projected, projections, fallback, checked);
    assert.equal(parent.bindingProjection.get(other) === undefined, true);
    assert.equal(child.minimumFoundation(), "core");
  });
}

test("typed producers never publish their records on an independent lookalike source object", () => {
  for (const [family, producer, attempt] of families) {
    const builder = createRustProgramRecordBuilder();
    const builderRequiredRecords = [];
    attempt(builder[producer]);
    assert.equal(builder[family].get(subject) !== undefined, true, family);
    assert.equal(builder[family].get({}) === undefined, true, family);
  }
  assert.equal(Object.isFrozen(subject), false, "producer freezing never freezes checked AST objects");
});
