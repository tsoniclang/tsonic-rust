import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { selectRustNumericConstraintComparison } from "../../../../dist/policy/operations/numeric/union.js";
import { recordRustIndexedCallKeyArguments } from "../../../../dist/analysis/operations/indexed-call-keys.js";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "uint64" };
const parameter = { kind: "type-parameter", identity: "Key", name: "Key" };
const comparison = () => selectRustNumericConstraintComparison("KindGreaterThanToken");
const selectedKey = (bindings = [{ sourceParameterIndex: 0, sourceArgumentIndex: 0, sourceForm: "value" }]) => ({
  member: { parameters: [{ name: "key", type: parameter }] }, sourceArgumentBindings: bindings,
});
const projection = () => ({ kind: "js-value-from-properties", source: integer, fields: [] });

test("five producers publish exactly the original immutable family readers and no generic writer", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const families = [["nativeGuardResult", "nativeGuardResults"], ["nativeUnreachable", "nativeUnreachableNodes"],
    ["genericNumericOperands", "genericNumerics"], ["indexedFieldKeyArgument", "indexedFieldKeys"],
    ["propertyProjection", "propertyProjections"]];
  const records = builder.seal(builderRequiredRecords);
  assert.equal(Object.keys(records).length, 348, "348 sealed analysis record families, including the canonical nativeHandler and nativeTaskUse families");
  for (const [family, producer] of families) {
    assert.equal(builder[family] === builder[producer].records, true, family);
    assert.equal(records[family] === builder[family], true, family);
    assert.equal(Object.isFrozen(records[family]), true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(records[family].get(undefined) === undefined, true, family);
    assert.equal(records[family].get({}) === undefined, true, family);
    for (const removed of ["set", "admit", "reuse", "seal"]) {
      assert.equal(records[family][removed] === undefined, true, `${family}: ${removed}`);
    }
    assert.equal(records[producer] === undefined, true, producer);
  }
});

test("native guard caching preserves false and skips re-selection of exact source identities", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const expression = {};
  let selected = 0;
  const select = () => { selected += 1; return false; };
  assert.equal(builder.nativeGuardResults.resolve(expression, select), false);
  assert.equal(builder.nativeGuardResult.get(expression), false);
  assert.equal(builder.nativeGuardResults.resolve(expression, () => true), false);
  assert.equal(builder.nativeGuardResult.get({}) === undefined, true);
  assert.equal(selected, 1);
  const unknown = {};
  assert.equal(builder.nativeGuardResults.resolve(unknown, () => undefined) === undefined, true);
  assert.equal(builder.nativeGuardResult.get(unknown) === undefined, true);
  assert.equal(builder.nativeGuardResults.resolve(unknown, () => true), true);
  assert.equal(builder.nativeGuardResult.get(unknown), true);
});

test("unreachable publication caches only true and preserves repeated false evaluation", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const node = {};
  let selections = 0;
  const reachable = () => { selections += 1; return false; };
  assert.equal(builder.nativeUnreachableNodes.resolve(node, reachable), false);
  assert.equal(builder.nativeUnreachableNodes.resolve(node, reachable), false);
  assert.equal(selections, 2);
  assert.equal(builder.nativeUnreachable.get(node) === undefined, true);
  assert.equal(builder.nativeUnreachableNodes.resolve(node, () => true), true);
  assert.equal(builder.nativeUnreachableNodes.resolve(node, reachable), true);
  assert.equal(selections, 2);
  assert.equal(builder.nativeUnreachable.get(node), true);
});

test("control-flow producers reuse inherited evidence without shadowing or mutating parent scopes", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const guard = {};
  const unreachable = {};
  parent.nativeGuardResults.resolve(guard, () => false);
  parent.nativeUnreachableNodes.resolve(unreachable, () => true);
  const child = createRustProgramRecordBuilder(undefined, parent);
  const childRequiredRecords = [];
  const unexpected = () => { assert.fail("inherited exact proof must not be recomputed"); };
  assert.equal(child.nativeGuardResults.resolve(guard, unexpected), false);
  assert.equal(child.nativeUnreachableNodes.resolve(unreachable, unexpected), true);
  const later = {};
  parent.nativeGuardResults.resolve(later, () => true);
  assert.equal(child.nativeGuardResult.get(later), true, "inheritance remains live before parent seal");
  const specialized = {};
  child.nativeGuardResults.resolve(specialized, () => false);
  assert.equal(parent.nativeGuardResult.get(specialized) === undefined, true);
  const inherited = parent.seal(parentRequiredRecords);
  const records = child.seal(childRequiredRecords);
  assert.equal(records.nativeGuardResult.get(specialized), false);
  assert.equal(inherited.nativeGuardResult.get(specialized) === undefined, true);
});

test("generic comparison publication retains operation and operand identity, order and immutable pair", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const subject = {};
  const selected = comparison();
  assert.equal(builder.genericNumerics.comparison(subject, parameter, wide, selected) === selected, true);
  const record = builder.genericNumericOperands.get(subject);
  assert.equal(record.length, 2);
  assert.equal(record[0] === parameter && record[1] === wide, true);
  assert.equal(Object.isFrozen(record), true);
  assert.throws(() => builder.genericNumerics.comparison(subject, { ...parameter }, { ...wide }, comparison()), /Duplicate Rust semantic plan/u);
  assertRustInheritedRecordCorrespondence("genericNumericOperands", subject, record,
    candidate => candidate.genericNumerics.comparison(subject, { ...parameter }, { ...wide }, comparison()));
  assert.equal(builder.genericNumericOperands.get(subject) === record, true);
  assertRustInheritedRecordConflict("genericNumericOperands", subject, record,
    candidate => candidate.genericNumerics.comparison(subject, wide, parameter, comparison()),
    /Conflicting Rust semantic plan 'tsonic.rust.genericNumericOperands'/u);
  assert.equal(builder.genericNumericOperands.get(subject) === record, true);
  assert.equal(builder.genericNumerics.comparison({}, integer, wide, undefined) === undefined, true);
  assert.equal(builder.minimumFoundation(), "core");
});

test("generic operands inherit canonical evidence and isolate genuinely new source subjects", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const subject = {};
  parent.genericNumerics.comparison(subject, integer, wide, comparison());
  const record = parent.genericNumericOperands.get(subject);
  const inherited = parent.seal(parentRequiredRecords);
  const child = createRustProgramRecordBuilder(undefined, inherited);
  const childRequiredRecords = [];
  child.genericNumerics.comparison(subject, { ...integer }, { ...wide }, comparison());
  assert.equal(child.genericNumericOperands.get(subject) === record, true);
  assertRustInheritedRecordConflict("genericNumericOperands", subject, record,
    candidate => candidate.genericNumerics.comparison(subject, integer, parameter, comparison()), /Conflicting Rust semantic plan/u);
  const newSubject = {};
  child.genericNumerics.comparison(newSubject, parameter, wide, comparison());
  assert.equal(inherited.genericNumericOperands.get(newSubject) === undefined, true);
  assert.equal(child.genericNumericOperands.get(newSubject)[0] === parameter, true);
});

test("indexed-key finalization uses actual source bindings and calls evaluation only for admitted arguments", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const first = {};
  const second = {};
  const ignored = {};
  const selected = selectedKey([
    { sourceParameterIndex: 0, sourceArgumentIndex: 1, sourceForm: "value" },
    { sourceParameterIndex: 0, sourceArgumentIndex: 0, sourceForm: "value" },
    { sourceParameterIndex: 1, sourceArgumentIndex: 2, sourceForm: "value" },
  ]);
  selected.member.parameters.push({ name: "ignored", type: integer });
  const seen = [];
  assert.equal(recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, selected, [first, second, ignored], new Map([["Key", wide]]), node => {
    seen.push(node);
    return node === first;
  }), true);
  assert.equal(seen.length, 2);
  assert.equal(seen[0] === second && seen[1] === first, true);
  assert.equal(builder.indexedFieldKeyArgument.get(first).carrier === wide, true);
  assert.equal(builder.indexedFieldKeyArgument.get(first).evaluate, true);
  assert.equal(builder.indexedFieldKeyArgument.get(second).evaluate, false);
  assert.equal(builder.indexedFieldKeyArgument.get(ignored) === undefined, true);
});

test("indexed-key finalization preserves original partial admission before a later invalid binding", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const argument = {};
  const selected = selectedKey([
    { sourceParameterIndex: 0, sourceArgumentIndex: 0, sourceForm: "value" },
    { sourceParameterIndex: 0, sourceArgumentIndex: 1, sourceForm: "value" },
  ]);
  let selections = 0;
  assert.equal(recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, selected, [argument], new Map([["Key", wide]]), () => {
    selections += 1;
    return false;
  }), false);
  assert.equal(selections, 1);
  assert.equal(builder.indexedFieldKeyArgument.get(argument).carrier === wide, true);
  assert.equal(builder.indexedFieldKeyArgument.get(argument).evaluate, false);
});

test("indexed keys reject nonvalue bindings, skip unresolved keys and retain structural conflicts", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const argument = {};
  const keys = new Map([["Key", wide]]);
  const select = selectedKey();
  assert.equal(recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, select, [argument], keys, () => false), true);
  const record = builder.indexedFieldKeyArgument.get(argument);
  assert.equal(recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, select, [argument], new Map([["Key", { ...wide }]]), () => false), true);
  assert.equal(builder.indexedFieldKeyArgument.get(argument) === record, true);
  for (const [changedKeys, evaluate] of [[new Map([["Key", integer]]), () => false], [keys, () => true]]) {
    assert.throws(() => recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, select, [argument], changedKeys, evaluate),
      /Conflicting Rust semantic plan 'tsonic.rust.indexedFieldKeyArgument'/u);
    assert.equal(builder.indexedFieldKeyArgument.get(argument) === record, true);
  }
  const unseen = {};
  assert.equal(recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, selectedKey([{ sourceParameterIndex: 0, sourceArgumentIndex: 0, sourceForm: "spread" }]),
    [unseen], keys, () => { assert.fail("a spread cannot be evaluated as one key"); }), false);
  for (const selectedKeys of [new Map(), new Map([["Key", parameter]])]) {
    assert.equal(recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, select, [unseen], selectedKeys,
      () => { assert.fail("unresolved key cannot be admitted"); }), true);
    assert.equal(builder.indexedFieldKeyArgument.get(unseen) === undefined, true);
  }
});

test("indexed keys retain inherited metadata identity and cannot leak into their parent", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const subject = {};
  const signature = selectedKey();
  const keys = new Map([["Key", wide]]);
  recordRustIndexedCallKeyArguments(parent, parentRequiredRecords, signature, [subject], keys, () => false);
  const original = parent.indexedFieldKeyArgument.get(subject);
  const inherited = parent.seal(parentRequiredRecords);
  const child = createRustProgramRecordBuilder(undefined, inherited);
  const childRequiredRecords = [];
  recordRustIndexedCallKeyArguments(child, childRequiredRecords, signature, [subject], keys, () => false);
  assert.equal(child.indexedFieldKeyArgument.get(subject) === original, true);
  assert.throws(() => recordRustIndexedCallKeyArguments(child, childRequiredRecords, signature, [subject], keys, () => true), /Conflicting Rust semantic plan/u);
  const fresh = {};
  recordRustIndexedCallKeyArguments(child, childRequiredRecords, signature, [fresh], keys, () => true);
  assert.equal(inherited.indexedFieldKeyArgument.get(fresh) === undefined, true);
  assert.equal(child.indexedFieldKeyArgument.get(fresh).evaluate, true);
});

test("property projections freeze the selected cases and preserve exact conversion and read evidence", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const expression = {};
  const conversion = projection();
  const read = {};
  const cases = [{ source: integer, conversion, reads: [read] }];
  assert.equal(builder.propertyProjections.finalize(expression, conversion, cases) === conversion, true);
  const record = builder.propertyProjection.get(expression);
  assert.equal(Object.isFrozen(record) && Object.isFrozen(record.cases), true);
  assert.equal(record.conversion === conversion && record.cases === cases, true);
  assert.equal(record.cases[0].reads[0] === read, true);
  const equivalent = projection();
  assert.throws(() => builder.propertyProjections.finalize(expression, equivalent, []), /Duplicate Rust semantic plan/u);
  assert.equal(builder.propertyProjection.get(expression) === record, true, "a repeated constructor cannot discard original cases");
  assertRustInheritedRecordConflict("propertyProjection", expression, record,
    candidate => candidate.propertyProjections.finalize(expression, { ...conversion, source: wide }, []), /Conflicting Rust semantic plan/u);
  assert.equal(builder.propertyProjection.get(expression) === record, true, "conflicts fail without changing evidence");
  const absent = {};
  assert.equal(builder.propertyProjections.finalize(absent, undefined, []) === undefined, true);
  assert.equal(builder.propertyProjection.get(absent) === undefined, true);
  assert.equal(builder.minimumFoundation(), "core", "this family does not charge conversion foundation again");
});

test("property projection scopes preserve original case identity and reject incompatible specialization", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const subject = {};
  parent.propertyProjections.finalize(subject, projection(), []);
  const inherited = parent.seal(parentRequiredRecords);
  const original = inherited.propertyProjection.get(subject);
  const child = createRustProgramRecordBuilder(undefined, inherited);
  const childRequiredRecords = [];
  const equivalent = projection();
  assert.equal(child.propertyProjections.finalize(subject, equivalent, []) === original.conversion, true);
  assert.equal(child.propertyProjection.get(subject) === original, true);
  assertRustInheritedRecordConflict("propertyProjection", subject, original,
    candidate => candidate.propertyProjections.finalize(subject, { ...equivalent, source: wide }, []), /Conflicting Rust semantic plan/u);
  assert.equal(child.propertyProjection.get(subject) === original, true);
  const specialized = {};
  child.propertyProjections.finalize(specialized, equivalent, []);
  assert.equal(inherited.propertyProjection.get(specialized) === undefined, true);
});

test("sealing closes every producer before cache reads, rejected selections or source callbacks", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const guard = {};
  const unreachable = {};
  builder.nativeGuardResults.resolve(guard, () => false);
  builder.nativeUnreachableNodes.resolve(unreachable, () => true);
  builder.seal(builderRequiredRecords);
  const unexpected = () => { assert.fail("a sealed producer must not inspect source or read inheritance"); };
  for (const subject of [guard, unreachable, {}]) {
    for (const write of [
      () => builder.nativeGuardResults.resolve(subject, unexpected),
      () => builder.nativeUnreachableNodes.resolve(subject, unexpected),
      () => builder.genericNumerics.comparison(subject, integer, wide, comparison()),
      () => builder.genericNumerics.comparison(subject, integer, wide, undefined),
      () => recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, selectedKey(), [subject], new Map([["Key", wide]]), unexpected),
      () => recordRustIndexedCallKeyArguments(builder, builderRequiredRecords, { member: { parameters: [] } }, [], new Map(), unexpected),
      () => builder.propertyProjections.finalize(subject, projection(), []),
      () => builder.propertyProjections.finalize(subject, undefined, []),
    ]) assert.throws(write, /after analysis is sealed/u);
  }
  assert.equal(builder.nativeGuardResult.get(guard), false);
  assert.equal(builder.nativeUnreachable.get(unreachable), true);
});
