import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustSelectedOperationProducer } from "../../../../dist/analysis/program/records/operations/selected-operation.js";
import * as selectedOperationModule from "../../../../dist/analysis/program/records/operations/selected-operation.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import {
  rustPostCheckBinaryOperationId,
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
} from "../../../../dist/target-model/operations/model.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const operation = (changes = {}) => ({
  operationId: "source.selected",
  operationKind: "method",
  targetOperation: "core::mem::size_of",
  resultType: integer,
  ...changes,
});
const accepted = value => ({ kind: "accept", value, evidence: [] });

test("the typed record owner exposes no source-call selection or deferred orchestration entrypoint", () => {
  assert.deepEqual(Object.keys(selectedOperationModule), ["createRustSelectedOperationProducer"]);
});

test("selected-operation records have one typed immutable reader and no general writer", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  builder.selectedOperations.project(subject, "project", "method", "function", integer);
  const records = builder.seal([]);
  assert.equal(records.selectedOperation === builder.selectedOperations.records, true);
  assert.equal(records.selectedOperation === builder.selectedOperation, true);
  assert.equal(Object.isFrozen(records.selectedOperation), true);
  assert.deepEqual(Object.keys(records.selectedOperation), ["get"]);
  assert.equal(builder.selectedOperation.set === undefined, true);
  assert.equal(records.selectedOperations === undefined, true);
  assert.equal(records.selectedOperation.get(subject)?.operationId, "project");
});

test("checked operation admission preserves result, source identities and selected evidence", () => {
  const producer = createRustSelectedOperationProducer();
  const subject = {};
  const provenance = { sourceExpression: {}, sourceReceiver: {}, sourceSelectedSignature: {},
    sourceSelectedSymbol: {}, sourceSelectedDeclaration: {}, sourceResultType: {} };
  const selected = operation({ provenance });
  const result = accepted({ operation: selected, convertedType: integer });
  assert.equal(producer.checked(subject, result) === undefined, true, "no deferred native carrier");
  assert.equal(producer.records.get(subject) === selected, true, "same selected evidence");
  assert.equal(producer.records.get(subject)?.provenance === provenance, true, "no copied source evidence");
  assert.equal(producer.records.get({}) === undefined, true, "equal-looking subject is foreign");
  assert.equal(producer.records.get(undefined) === undefined, true, "missing subject stays absent");
});

test("reject, source-only and deferred callback results never publish an operation", () => {
  const producer = createRustSelectedOperationProducer();
  const subject = {};
  for (const selection of [
    { kind: "reject", diagnostic: { message: "rejected" } },
    accepted({ kind: "source" }),
    accepted({ kind: "deferred-callback" }),
  ]) {
    assert.equal(producer.checked(subject, selection) === undefined, true, selection.kind);
    assert.equal(producer.records.get(subject) === undefined, true, selection.kind);
    assert.equal(producer.minimumFoundation(), "core", selection.kind);
  }
});

test("post-check placeholders are not admitted before their native carrier is finalized", () => {
  for (const operationId of [rustPostCheckBinaryOperationId, rustPostCheckUnaryMinusOperationId,
    rustPostCheckUnaryPlusOperationId]) {
    const producer = createRustSelectedOperationProducer();
    const subject = {};
    assert.equal(producer.checked(subject, accepted({ operation: operation({ operationId, resultType: text }) })),
      operationId === rustPostCheckBinaryOperationId ? "binary" :
        operationId === rustPostCheckUnaryMinusOperationId ? "unary-minus" : "unary-plus");
    assert.equal(producer.records.get(subject) === undefined, true, operationId);
    assert.equal(producer.minimumFoundation(), "core", operationId);
    producer.operator(subject, { kind: "operator-token", operationId, operator: "-", resultCarrier: integer }, integer);
    assert.equal(producer.records.get(subject)?.operationId, operationId);
    assert.equal(producer.records.get(subject)?.resultType === integer, true, operationId);
    assert.equal(producer.records.get(subject)?.provenance.sourceExpression === subject, true, operationId);
  }
});

test("finalized operators and project selections construct their exact canonical records", () => {
  const producer = createRustSelectedOperationProducer();
  const unary = {};
  producer.operator(unary, { kind: "operator-token", operationId: "unary", operator: "-", resultCarrier: integer }, integer);
  assert.deepEqual(producer.records.get(unary), { operationId: "unary", operationKind: "operator",
    targetOperation: "-", resultType: integer, provenance: { sourceExpression: unary } });
  const project = {};
  producer.project(project, "project", "constructor", "associated-call", text);
  assert.deepEqual(producer.records.get(project), { operationId: "project", operationKind: "constructor",
    targetOperation: "associated-call", resultType: text });
});

test("canonical equality retains exact provenance and refuses competing decisions", () => {
  const subject = {};
  const provenance = { sourceExpression: {}, sourceReceiver: {}, sourceSelectedSignature: {},
    sourceSelectedDeclaration: {}, sourceSelectedSymbol: {} };
  const original = operation({ provenance });
  const producer = createRustSelectedOperationProducer();
  producer.checked(subject, accepted({ operation: original }));
  assertRustInheritedRecordCorrespondence("selectedOperation", subject, original,
    candidate => candidate.selectedOperations.checked(subject, accepted({ operation: { ...original, resultType: { ...integer }, provenance: { ...provenance } } })));
  assert.equal(producer.records.get(subject) === original, true, "equivalent admission does not replace evidence");
  const mutations = [
    { operationId: "different" }, { operationKind: "property" }, { targetOperation: "different" },
    { resultType: text }, { provenance: undefined },
    ...Object.keys(provenance).map(key => ({ provenance: { ...provenance, [key]: {} } })),
    { providerDeclaration: { providerId: "different" } },
  ];
  for (const [index, mutation] of mutations.entries()) {
    assertRustInheritedRecordConflict("selectedOperation", subject, original,
      candidate => candidate.selectedOperations.checked(subject, accepted({ operation: { ...original, ...mutation } })),
      /Conflicting Rust semantic plan 'selectedOperation'/u, `mutation ${index}`);
    assert.equal(producer.records.get(subject) === original, true, `no cached-first suppression ${index}`);
  }
});

test("inherited operation records preserve exact scope and reject incompatible overrides", () => {
  const parent = createRustProgramRecordBuilder();
  const inheritedSubject = {};
  const original = operation({ provenance: { sourceExpression: inheritedSubject } });
  parent.selectedOperations.checked(inheritedSubject, accepted({ operation: original }));
  const parentRecords = parent.seal([]);
  const child = createRustProgramRecordBuilder(undefined, parentRecords);
  assert.equal(child.selectedOperation.get(inheritedSubject) === original, true);
  child.selectedOperations.checked(inheritedSubject, accepted({ operation: { ...original, resultType: { ...integer } } }));
  assert.equal(child.selectedOperation.get(inheritedSubject) === original, true);
  assertRustInheritedRecordConflict("selectedOperation", inheritedSubject, original, candidate => candidate.selectedOperations.checked(inheritedSubject,
    accepted({ operation: { ...original, resultType: text } })), /Conflicting Rust semantic plan/u);
  const childSubject = {};
  child.selectedOperations.project(childSubject, "specialized", "method", "function", text);
  assert.equal(parentRecords.selectedOperation.get(childSubject) === undefined, true, "child never mutates parent");
  const childRecords = child.seal([]);
  assert.equal(childRecords.selectedOperation.get(childSubject)?.operationId, "specialized");
  assert.equal(childRecords.selectedOperation.get(inheritedSubject) === original, true);
});

test("distinct generic carrier contexts never collapse into a cached first selection", () => {
  const producer = createRustSelectedOperationProducer();
  const carrier = element => ({ kind: "target-named", id: "acme.Container", genericArguments: [{ kind: "type", type: element }] });
  const subject = {};
  producer.checked(subject, accepted({ operation: operation({ resultType: carrier(integer) }) }));
  assertRustInheritedRecordConflict("selectedOperation", subject, producer.records.get(subject),
    candidate => candidate.selectedOperations.checked(subject, accepted({ operation: operation({ resultType: carrier(text) }) })),
    /Conflicting Rust semantic plan/u);
  const scoped = {};
  producer.checked(scoped, accepted({ operation: operation({ resultType: carrier(text) }) }));
  assert.equal(producer.records.get(scoped)?.resultType.genericArguments[0].type === text, true);
});

test("selected-operation native foundation accounting is retained by its owner", () => {
  for (const [targetOperation, resultType, expected] of [
    ["core::mem::size_of", integer, "core"], ["alloc::vec::new", integer, "alloc"],
    ["core::mem::take", text, "alloc"], ["std::thread::current", integer, "std"],
    ["js_abi::some_operation", undefined, "std"],
  ]) {
    const builder = createRustProgramRecordBuilder();
    const subject = {};
    const selected = operation({ targetOperation, resultType });
    builder.selectedOperations.checked(subject, accepted({ operation: selected }));
    assert.equal(builder.minimumFoundation(), expected, targetOperation);
    builder.seal([]);
    assert.equal(builder.minimumFoundation(), expected, targetOperation + " after seal");
  }
  const builder = createRustProgramRecordBuilder();
  builder.runtimeCarriers.selected({}, text);
  builder.selectedOperations.project({}, "core", "method", "core::mem::size_of", integer);
  assert.equal(builder.minimumFoundation(), "alloc", "other families remain in the same maximum");
});

test("a sealed selected-operation owner cannot publish through any admission form", () => {
  const producer = createRustSelectedOperationProducer();
  const subject = {};
  const selected = operation();
  producer.checked(subject, accepted({ operation: selected }));
  producer.seal();
  for (const write of [
    () => producer.checked({}, accepted({ operation: selected })),
    () => producer.operator({}, { kind: "operator-token", operationId: "unary", operator: "-" }, integer),
    () => producer.project({}, "project", "method", "function", integer),
    () => producer.seal(),
  ]) assert.throws(write, /after analysis is sealed/u);
  for (let read = 0; read < 32; read += 1) {
    assert.equal(producer.records.get(subject) === selected, true);
    assert.equal(producer.records.get({}) === undefined, true);
    assert.equal(producer.minimumFoundation(), "core");
  }
});
