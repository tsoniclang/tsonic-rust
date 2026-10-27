import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { selectedRustCallSignature } from "../../../../dist/analysis/program/records/calls/selected-call.js";
import { setCarrierFact } from "../../../../dist/analysis/operations/project-calls.js";
import { acceptRustOperation } from "../../../../dist/analysis/program/records/operations/selected-operation-values.js";
import { rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../../../../dist/target-model/operations/model.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const external = { kind: "target-named", id: "acme.native.Failure" };
const accepted = value => ({ kind: "accept", value });
const member = { id: "native.identity", sourceName: "identity", targetName: "identity", kind: "method",
  parameters: [{ name: "value", type: integer, passingMode: "value" }], returnType: integer };

function requestFor(call = {}) {
  return { source: { call, sourceCallee: {}, sourceArgumentBindings: [], sourceSelectedSignatureParameters: [] } };
}

test("the three closed families publish canonical readers and no writer or producer capability", () => {
  const builder = createRustProgramRecordBuilder();
  const owners = [["runtimeCarrier", "runtimeCarriers"], ["selectedCall", "selectedCalls"],
    ["targetOperation", "targetOperations"]];
  const records = builder.seal([]);
  for (const [family, producer] of owners) {
    assert.equal(builder[family] === builder[producer].records, true, family);
    assert.equal(records[family] === builder[family], true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(records[family].get(undefined) === undefined, true, family);
    assert.equal(records[family].get({}) === undefined, true, family);
    for (const removed of ["set", "admit", "seal"]) assert.equal(records[family][removed] === undefined, true, family);
    assert.equal(records[producer] === undefined, true, family);
  }
  const request = requestFor();
  for (const write of [
    () => builder.runtimeCarriers.selected({}, integer),
    () => builder.runtimeCarriers.source({}, integer),
    () => builder.targetOperations.source({}, { kind: "source-conversion", operationId: "identity", resultCarrier: integer }),
    () => builder.targetOperations.checked({}, accepted({})),
    () => builder.targetOperations.enumLiteral({}, "One", integer),
    () => builder.targetOperations.unaryMinusLiteral({}, integer),
    () => builder.targetOperations.unaryPlusLiteral({}, integer),
    () => builder.selectedCalls.checked(request, { kind: "reject", diagnostic: {} }),
  ]) assert.throws(write, /after analysis is sealed/u);
});

test("source runtime-carrier conflicts retain the exact diagnostic and rejected-expression bookkeeping", () => {
  const records = createRustProgramRecordBuilder();
  const subject = {};
  const dependent = {};
  const diagnostics = [];
  const walk = { context: { requiredRecords: [], records, diagnostics }, rejectedExpressions: new WeakSet(), resolving: new Set([dependent]) };
  assert.equal(setCarrierFact(walk, subject, integer) === integer, true);
  const first = records.runtimeCarrier.get(subject);
  assert.equal(setCarrierFact(walk, subject, { ...integer }) === integer, true, "equal input retains its exact original carrier");
  assert.equal(diagnostics.length, 0);
  assert.equal(setCarrierFact(walk, subject, external) === undefined, true);
  assert.equal(records.runtimeCarrier.get(subject) === first, true, "no conflicting publication");
  assert.equal(records.minimumFoundation(), "core", "no conflicting accounting");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "RUST_RUNTIME_CARRIER_CONFLICT");
  assert.equal(diagnostics[0].sourceNode === subject, true);
  assert.equal(diagnostics[0].message,
    "Selected source evidence and Rust analysis produced incompatible runtime carriers for the same source subject.");
  assert.deepEqual(diagnostics[0].evidence, ["target.capability=rust.runtime-carrier.single-owner",
    `existing=${JSON.stringify(integer)}`, `incoming=${JSON.stringify(external)}`]);
  assert.equal(walk.rejectedExpressions.has(subject), true);
  assert.equal(walk.rejectedExpressions.has(dependent), true);
  assert.throws(() => records.runtimeCarriers.selected(subject, external), /Duplicate Rust semantic plan/u,
    "the internal publication channel refuses a second local decision before comparison");
  assertRustInheritedRecordConflict("runtimeCarrier", subject, first,
    candidate => candidate.runtimeCarriers.selected(subject, external), /Conflicting Rust semantic plan/u);
  assert.equal(diagnostics.length, 1, "the internal channel never adds a source diagnostic");
});

test("source inherited reuse preserves the exact stored carrier without counting a publication", () => {
  const parent = createRustProgramRecordBuilder();
  const subject = {};
  parent.runtimeCarriers.selected(subject, text);
  const original = parent.runtimeCarrier.get(subject);
  const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
  const walk = { context: { requiredRecords: [], records: child, diagnostics: [] }, rejectedExpressions: new WeakSet(), resolving: new Set() };
  assert.equal(setCarrierFact(walk, subject, { ...text }) === text, true);
  assert.equal(child.runtimeCarrier.get(subject) === original, true);
  assert.equal(child.minimumFoundation(), "core", "reuse retains the original probe accounting");
  assert.equal(setCarrierFact(walk, subject, external) === undefined, true);
  assert.equal(child.minimumFoundation(), "core", "conflict cannot account an inherited record either");
  child.runtimeCarriers.selected(subject, { ...text });
  assert.equal(child.minimumFoundation(), "alloc", "strict inherited publication still accounts");
  const fresh = {};
  assert.equal(setCarrierFact(walk, fresh, integer) === integer, true);
  assert.equal(parent.runtimeCarrier.get(fresh) === undefined, true, "the child never mutates its parent");
  child.seal([]);
  for (const candidate of [subject, fresh, {}]) assert.throws(() => setCarrierFact(walk, candidate, integer),
    /after analysis is sealed/u);
});

test("target operation constructors retain checked data, exact source identities and native foundation", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const declaration = {};
  const fact = { kind: "source-field", operationId: "field", declaration, accessMode: "read", storage: "project-object",
    storageIndex: 0, receiverCarrier: integer, resultCarrier: text, valueSemantics: { kind: "stored" } };
  const provenance = { sourceExpression: subject };
  const selection = acceptRustOperation(fact, provenance);
  assert.equal(selection.value.targetFact === fact, true, "pure selection returns the actual native decision");
  assert.equal(builder.targetOperation.get(subject) === undefined, true, "construction does not publish");
  builder.targetOperations.checked(subject, selection);
  assert.equal(builder.targetOperation.get(subject) === fact, true);
  assert.equal(builder.minimumFoundation(), "alloc");
  assertRustInheritedRecordCorrespondence("targetOperation", subject, fact,
    candidate => candidate.targetOperations.checked(subject, accepted({ targetFact: { ...fact, resultCarrier: { ...text } } })));
  assert.equal(builder.targetOperation.get(subject) === fact, true);
  assertRustInheritedRecordConflict("targetOperation", subject, fact, candidate => candidate.targetOperations.checked(subject,
    accepted({ targetFact: { ...fact, declaration: {} } })), /Conflicting Rust semantic plan/u);
  assert.equal(builder.targetOperation.get(subject) === fact, true);
  assert.equal(builder.targetOperation.get({}) === undefined, true);
  const absent = {};
  builder.targetOperations.checked(absent, { kind: "reject", diagnostic: {} });
  builder.targetOperations.checked(absent, accepted({}));
  assert.equal(builder.targetOperation.get(absent) === undefined, true);
});

test("literal constructors retain the exact finalized native forms rather than reselecting a carrier", () => {
  const builder = createRustProgramRecordBuilder();
  const enumSubject = {};
  builder.targetOperations.enumLiteral(enumSubject, "One", integer);
  assert.deepEqual(builder.targetOperation.get(enumSubject), { kind: "source-enum-member",
    operationId: "tsonic.rust.union.variant:One", name: "One",
    enumRepresentation: { kind: "literal-union" }, resultCarrier: integer });
  for (const [operationId, kind, construct] of [[rustPostCheckUnaryMinusOperationId, "operator-token", builder.targetOperations.unaryMinusLiteral],
    [rustPostCheckUnaryPlusOperationId, "source-conversion", builder.targetOperations.unaryPlusLiteral]]) {
    const subject = {};
    const fact = construct(subject, integer);
    assert.equal(builder.targetOperation.get(subject) === fact, true);
    assert.equal(fact.kind, kind);
    assert.equal(fact.operationId, operationId);
    assert.equal(fact.resultCarrier === integer, true);
    if (kind === "operator-token") assert.equal(fact.operator, "-");
  }
});

test("one selected-call constructor retains every exact checked-source evidence port", () => {
  const request = requestFor();
  const selectedSymbol = {};
  const selectedDeclaration = {};
  Object.assign(request.source.sourceCallee, { selectedSymbol, symbol: {}, selectedDeclaration, declaration: {} });
  Object.assign(request.source, { selectedSignature: {}, sourceResultType: {}, sourceSelectedMethodTypeArguments: [] });
  request.sourceSelectedDeclaration = {};
  const owner = { kind: "type-parameter", identity: "Owner", name: "Owner" };
  const signature = selectedRustCallSignature(request, member, { sourceSelectedOwnerCarrier: owner });
  for (const [field, value] of Object.entries({ member, sourceCalleeSymbol: selectedSymbol,
    sourceCalleeDeclaration: selectedDeclaration, sourceSignature: request.source.selectedSignature,
    sourceDeclaration: request.sourceSelectedDeclaration, sourceReturnType: request.source.sourceResultType,
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments,
    sourceSelectedOwnerCarrier: owner })) assert.equal(signature[field] === value, true, field);
  const builder = createRustProgramRecordBuilder();
  builder.selectedCalls.checked(request, accepted({ selectedSignature: signature }));
  assert.equal(builder.selectedCall.get(request.source.call) === signature, true);
  const inherited = createRustProgramRecordBuilder(undefined, builder.seal([]));
  inherited.selectedCalls.checked(request, accepted({ selectedSignature: { ...signature } }));
  assert.equal(inherited.selectedCall.get(request.source.call) === signature, true);
  assertRustInheritedRecordConflict("selectedCall", request.source.call, signature, candidate => candidate.selectedCalls.checked(request,
    accepted({ selectedSignature: { ...signature, sourceSignature: {} } })), /Conflicting Rust semantic plan/u);
  assert.equal(inherited.selectedCall.get({}) === undefined, true);
});

test("source, deferred, rejected and flow-marker call contracts never manufacture a selected call", () => {
  const builder = createRustProgramRecordBuilder();
  const request = requestFor();
  for (const selection of [accepted({ kind: "source" }), accepted({ kind: "deferred-callback" }),
    { kind: "reject", diagnostic: {} }, accepted({ selectedSignature: { member },
      targetFact: { kind: "flow-marker", operationId: "flow", state: "moved" } })]) {
    builder.selectedCalls.checked(request, selection);
    assert.equal(builder.selectedCall.get(request.source.call) === undefined, true);
    assert.equal(builder.minimumFoundation(), "core");
  }
});
