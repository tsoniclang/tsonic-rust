import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { rustClosureCaptureEquals } from "../../../../dist/target-model/records/operations/equality.js";
import { rustSourceOptionalTargetType } from "../../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const subject = {};
const guard = {};
const operation = { operationId: "selected:callback", operationKind: "method" };
const contract = { sourceGuardCarrier: rustSourceOptionalTargetType(integer), selectedGuardCarrier: integer,
  guardDepth: 1, innerResultCarrier: integer, resultCarrier: rustSourceOptionalTargetType(integer), lowering: "map" };
const conflict = /Conflicting Rust semantic plan/u;
const sealed = /after analysis is sealed/u;
const families = [
  ["preparedOperationResult", "preparedOperations", producer => producer.prepare(subject, operation, integer)],
  ["optionalChain", "optionalChains", producer => producer.guard(subject, guard, "property", contract)],
  ["closureCapture", "closureCaptures", producer => producer.capture(subject, [])],
];

test("guard/capture families expose frozen readers, not generic writers or sealed producers", () => {
  const builder = createRustProgramRecordBuilder();
  const records = builder.seal([]);
  assert.equal(Object.keys(records).length, 347, "347 sealed analysis record families, including the canonical nativeHandler and nativeTaskUse families");
  for (const [family, producer, attempt] of families) {
    assert.equal(builder[family] === builder[producer].records && records[family] === builder[family], true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(Object.isFrozen(records[family]) && Object.isFrozen(builder[producer]), true, family);
    assert.equal(builder[family].set === undefined && records[producer] === undefined, true, family);
    assert.equal(records[family].get(subject) === undefined && records[family].get(undefined) === undefined, true, family);
    assert.throws(() => attempt(builder[producer]), sealed, producer);
  }
});

for (const operationKind of ["method", "constructor", "property", "indexer"]) {
  test(`prepared ${operationKind} derives only the selected native operation identity and result`, () => {
    const parent = createRustProgramRecordBuilder();
    const selected = { ...operation, operationKind, extra: true };
    parent.preparedOperations.prepare(subject, selected, integer);
    const first = parent.preparedOperationResult.get(subject);
    assert.deepEqual(Object.keys(first).sort(), ["operationId", "operationKind", "resultCarrier"]);
    assert.equal(first.operationId, selected.operationId);
    assert.equal(first.operationKind, operationKind);
    assert.equal(first.resultCarrier === integer && Object.isFrozen(first), true);
    selected.operationId = "later:mutation";
    assert.equal(first.operationId, operation.operationId);
    const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
    child.preparedOperations.prepare(subject, { ...operation, operationKind }, { ...integer });
    assert.equal(child.preparedOperationResult.get(subject) === first, true);
    for (const [template, carrier] of [
      [{ ...operation, operationKind, operationId: "different" }, integer],
      [{ ...operation, operationKind: operationKind === "method" ? "property" : "method" }, integer],
      [{ ...operation, operationKind }, wide],
    ]) assertRustInheritedRecordConflict("preparedOperationResult", subject, first,
      candidate => candidate.preparedOperations.prepare(subject, template, carrier), conflict);
    const other = {};
    child.preparedOperations.prepare(other, { ...operation, operationKind }, integer);
    assert.equal(child.preparedOperationResult.get(other) !== first, true);
    assert.equal(parent.preparedOperationResult.get(other) === undefined, true);
    assert.equal(child.minimumFoundation(), "core");
  });
}

for (const operationKind of ["property", "indexer", "method"]) for (const lowering of ["map", "and-then"]) {
  test(`optional ${operationKind}/${lowering} owns exact source identities and snapshots the selected contract`, () => {
    const parent = createRustProgramRecordBuilder();
    const selected = { ...contract, lowering, guardDepth: 2, extra: true, expression: {}, guard: {} };
    parent.optionalChains.guard(subject, guard, operationKind, selected);
    const first = parent.optionalChain.get(subject);
    assert.deepEqual(Object.keys(first).sort(), ["expression", "guard", "guardDepth", "innerResultCarrier", "lowering",
      "operationKind", "resultCarrier", "selectedGuardCarrier", "sourceGuardCarrier"]);
    assert.equal(first.expression === subject && first.guard === guard, true);
    assert.equal(first.operationKind, operationKind);
    assert.equal(first.lowering, lowering);
    assert.equal(first.guardDepth, 2);
    assert.equal(first.sourceGuardCarrier === contract.sourceGuardCarrier && first.innerResultCarrier === integer &&
      first.selectedGuardCarrier === integer && first.resultCarrier === contract.resultCarrier, true);
    assert.equal(Object.isFrozen(first), true);
    selected.guardDepth = 3;
    assert.equal(first.guardDepth, 2);
    const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
    const same = { ...contract, lowering, guardDepth: 2, sourceGuardCarrier: structuredClone(contract.sourceGuardCarrier) };
    child.optionalChains.guard(subject, guard, operationKind, same);
    assert.equal(child.optionalChain.get(subject) === first, true);
    assertRustInheritedRecordConflict("optionalChain", subject, first,
      candidate => candidate.optionalChains.guard(subject, {}, operationKind, same), conflict);
    assertRustInheritedRecordConflict("optionalChain", subject, first,
      candidate => candidate.optionalChains.guard(subject, guard, operationKind === "method" ? "property" : "method", same), conflict);
    for (const [key, value] of Object.entries(same)) {
      const replacement = key === "guardDepth" ? 1 : key === "lowering" ? lowering === "map" ? "and-then" : "map" : wide;
      assertRustInheritedRecordConflict("optionalChain", subject, first,
        candidate => candidate.optionalChains.guard(subject, guard, operationKind, { ...same, [key]: replacement }), conflict, key);
      assert.equal(child.optionalChain.get(subject) === first, true, key);
    }
    const other = {};
    child.optionalChains.guard(other, guard, operationKind, same);
    assert.equal(child.optionalChain.get(other)?.expression === other, true);
    assert.equal(parent.optionalChain.get(other) === undefined, true);
    assert.equal(child.minimumFoundation(), "core");
  });
}

for (const storage of ["value", "location", "cell", "borrow-cell"]) for (const mutable of [false, true]) {
  test(`logical ${storage}/${mutable ? "mutable" : "readonly"} capture preserves ordered exact declarations`, () => {
    const parent = createRustProgramRecordBuilder();
    const firstCapture = { declaration: {}, reference: {}, carrier: integer, storage, ...(mutable ? { mutable: true } : {}) };
    const secondCapture = { declaration: {}, reference: {}, carrier: wide, storage: "value" };
    const captures = [firstCapture, secondCapture];
    parent.closureCaptures.capture(subject, captures);
    const first = parent.closureCapture.get(subject);
    assert.equal(rustClosureCaptureEquals(first, { captures, receivers: [], receiverFields: [] }), true);
    assert.equal(first.captures[0].declaration === firstCapture.declaration && first.captures[0].reference === firstCapture.reference &&
      first.captures[0].carrier === integer && first.captures[1].declaration === secondCapture.declaration, true);
    assert.equal(Object.isFrozen(first) && Object.isFrozen(first.captures) && first.captures.every(Object.isFrozen) &&
      Object.isFrozen(first.receivers) && Object.isFrozen(first.receiverFields), true);
    assert.equal(Object.hasOwn(first.captures[0], "mutable"), mutable);
    for (const name of ["invocationOwner", "recursiveDeclaration", "recursiveField"]) assert.equal(Object.hasOwn(first, name), false, name);
    firstCapture.reference = {};
    captures.reverse();
    assert.equal(first.captures[0].reference === firstCapture.reference, false);
    const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
    const same = first.captures.map(capture => ({ ...capture, carrier: { ...capture.carrier } }));
    child.closureCaptures.capture(subject, same);
    assert.equal(child.closureCapture.get(subject) === first, true);
    for (const name of ["declaration", "reference", "carrier", "storage", "mutable"]) {
      const replacement = name === "carrier" ? wide : name === "storage" ? storage === "value" ? "cell" : "value" :
        name === "mutable" ? mutable ? undefined : true : {};
      assertRustInheritedRecordConflict("closureCapture", subject, first,
        candidate => candidate.closureCaptures.capture(subject, [{ ...same[0], [name]: replacement }, same[1]]), conflict, name);
    }
    assertRustInheritedRecordConflict("closureCapture", subject, first,
      candidate => candidate.closureCaptures.capture(subject, [...same].reverse()), conflict);
    assertRustInheritedRecordConflict("closureCapture", subject, first,
      candidate => candidate.closureCaptures.capture(subject, same.slice(0, 1)), conflict);
    const other = {};
    child.closureCaptures.capture(other, []);
    assert.equal(child.closureCapture.get(other)?.captures.length, 0);
    assert.equal(parent.closureCapture.get(other) === undefined, true);
    assert.equal(child.minimumFoundation(), "core");
  });
}

test("selected class-environment capture metadata survives canonical publication without a DTO projection", () => {
  const builder = createRustProgramRecordBuilder();
  const capture = { declaration: {}, reference: {}, carrier: integer, storage: "value", fieldName: "captured" };
  builder.closureCaptures.capture(subject, [capture]);
  const selected = builder.closureCapture.get(subject).captures[0];
  assert.deepEqual(Object.keys(selected).sort(), Object.keys(capture).sort());
  assert.equal(selected.declaration === capture.declaration && selected.reference === capture.reference && selected.carrier === integer, true);
  assert.equal(selected.fieldName, "captured");
  assert.equal(Object.isFrozen(selected), true);
  capture.fieldName = "later";
  assert.equal(selected.fieldName, "captured");
  const record = builder.closureCapture.get(subject);
  assert.equal(rustClosureCaptureEquals(record, record), true, "class capture equality is reflexive");
  const equivalent = { captures: [{ ...selected }], receivers: [], receiverFields: [] };
  assert.equal(rustClosureCaptureEquals(record, equivalent), true, "independent complete capture metadata is equivalent");
  const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
  child.closureCaptures.capture(subject, equivalent.captures);
  assert.equal(child.closureCapture.get(subject) === record, true, "an inherited exact class capture preserves its canonical record");
  const { fieldName: omitted, ...logical } = selected;
  assert.equal(omitted, "captured");
  for (const invalid of [{ ...selected, fieldName: "different" }, logical, { ...selected, fieldName: undefined },
    { ...selected, fieldName: 1 }, { ...selected, unknown: true }]) {
    assert.equal(rustClosureCaptureEquals(record, { ...equivalent, captures: [invalid] }), false,
      "field identity, presence, type and closed shape are significant");
    assertRustInheritedRecordConflict("closureCapture", subject, record,
      candidate => candidate.closureCaptures.capture(subject, [invalid]), conflict);
  }
  let accessorReads = 0;
  const accessor = Object.defineProperty({ ...logical }, "fieldName", { enumerable: true, get() { accessorReads += 1; return "captured"; } });
  assert.equal(rustClosureCaptureEquals(record, { ...equivalent, captures: [accessor] }), false,
    "equality does not evaluate accessor-bearing metadata");
  assert.equal(accessorReads, 0);
});

test("receiver, field and recursive captures retain all source roots, ordering and shared invocation ownership", () => {
  const parent = createRustProgramRecordBuilder();
  const receiverReference = {};
  const fieldReference = {};
  const recursiveReference = {};
  const receivers = [{ owner: {}, reference: receiverReference, references: [receiverReference, {}], carrier: integer }];
  const fields = [{ declaration: {}, receiver: {}, reference: fieldReference, references: [fieldReference, {}], carrier: wide,
    storage: { kind: "shared", initialization: "deferred" } }];
  const recursiveDeclaration = {};
  const recursiveField = { declaration: recursiveDeclaration, receiver: {}, reference: recursiveReference,
    references: [recursiveReference, {}], carrier: integer };
  parent.closureCaptures.capture(subject, [], receivers, fields, { recursiveDeclaration, recursiveField }, "shared-state");
  const first = parent.closureCapture.get(subject);
  assert.equal(rustClosureCaptureEquals(first, { captures: [], receivers, receiverFields: fields,
    recursiveDeclaration, recursiveField, invocationOwner: "shared-state" }), true);
  assert.equal(first.receivers[0].owner === receivers[0].owner && first.receiverFields[0].declaration === fields[0].declaration &&
    first.recursiveDeclaration === recursiveDeclaration && first.recursiveField.reference === recursiveReference, true);
  assert.equal(Object.isFrozen(first.receivers[0]) && Object.isFrozen(first.receivers[0].references) &&
    Object.isFrozen(first.receiverFields[0]) && Object.isFrozen(first.receiverFields[0].references) &&
    Object.isFrozen(first.receiverFields[0].storage) && Object.isFrozen(first.recursiveField) && Object.isFrozen(first.recursiveField.references), true);
  const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
  const admit = (records, receiver = first.receivers, field = first.receiverFields,
    recursion = { recursiveDeclaration, recursiveField: first.recursiveField }, owner = "shared-state") =>
    records.closureCaptures.capture(subject, [], receiver, field, recursion, owner);
  admit(child);
  assert.equal(child.closureCapture.get(subject) === first, true);
  assertRustInheritedRecordConflict("closureCapture", subject, first, candidate => admit(candidate, [], first.receiverFields), conflict);
  assertRustInheritedRecordConflict("closureCapture", subject, first, candidate => admit(candidate, first.receivers, []), conflict);
  assertRustInheritedRecordConflict("closureCapture", subject, first, candidate => admit(candidate, first.receivers, first.receiverFields, {}), conflict);
  assertRustInheritedRecordConflict("closureCapture", subject, first, candidate => candidate.closureCaptures.capture(subject, [], first.receivers, first.receiverFields,
    { recursiveDeclaration, recursiveField: first.recursiveField }), conflict);
  for (const key of ["owner", "reference", "references", "carrier"]) {
    const replacement = key === "carrier" ? wide : key === "references" ? [receiverReference] : {};
    assertRustInheritedRecordConflict("closureCapture", subject, first, candidate => admit(candidate, [{ ...first.receivers[0], [key]: replacement }]), conflict, key);
  }
  for (const key of ["declaration", "receiver", "reference", "references", "carrier", "storage"]) {
    const replacement = key === "carrier" ? integer : key === "references" ? [fieldReference] :
      key === "storage" ? { kind: "shared", initialization: "ready" } : {};
    assertRustInheritedRecordConflict("closureCapture", subject, first, candidate => admit(candidate, first.receivers, [{ ...first.receiverFields[0], [key]: replacement }]), conflict, key);
  }
  for (const key of ["declaration", "receiver", "reference", "references", "carrier"]) {
    const replacement = key === "carrier" ? wide : key === "references" ? [recursiveReference] : {};
    assertRustInheritedRecordConflict("closureCapture", subject, first, candidate => admit(candidate, first.receivers, first.receiverFields,
      { recursiveDeclaration, recursiveField: { ...first.recursiveField, [key]: replacement } }), conflict, key);
  }
  receivers[0].references.reverse();
  fields[0].references.push({});
  fields[0].storage.initialization = "ready";
  recursiveField.references.reverse();
  assert.equal(first.receivers[0].reference === first.receivers[0].references[0], true);
  assert.equal(first.receiverFields[0].references.length, 2);
  assert.equal(first.receiverFields[0].storage.initialization, "deferred");
  assert.equal(first.recursiveField.reference === first.recursiveField.references[0], true);
});
