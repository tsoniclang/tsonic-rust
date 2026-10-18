import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustBindingStorageOperations } from "../../../../dist/backend/planner/expressions/binding-storage.js";
import { createRustCapturedField, rustCapturedFieldType, readRustCapturedField, writeRustCapturedField, writeRustCapturedFieldFromStorage } from "../../../../dist/backend/planner/objects/captured-fields.js";
import { readRustProjectObjectFieldOwner, writeRustProjectObjectField } from "../../../../dist/backend/planner/objects/project-objects.js";
import { rustStoredObjectFieldSupportsBorrowedRead } from "../../../../dist/backend/planner/objects/project-storage.js";
import { validatedRustCapturedFieldStorageFact } from "../../../../dist/analysis/storage/receiver-captures.js";
import { int32Carrier, stringCarrier } from "../../../helpers/rust-session.mjs";
import { selectRustCapturedFieldStorage } from "../../../../dist/policy/ownership/captured-field-storage.js";
import { createRustCapturedFieldStorageProducer } from "../../../../dist/analysis/program/records/captured-field-storage.js";
import { assertRustRequiredRecords, requireRustRecord } from "../../../../dist/analysis/program/records/required-records.js";
import { fieldFactKey } from "@tsonic/tsts";
import { selectRustNativeBindingStorage } from "../../../../dist/policy/ownership/binding-storage.js";

const owner = { kind: "path", path: "payload" };
const next = { kind: "path", path: "next" };

test("proven immutable scalar captures have no native heap owner or clone", () => {
  const storage = selectRustCapturedFieldStorage(int32Carrier, true, false, true);
  const native = selectRustNativeBindingStorage({ kind: "captured-field", storage: "copy",
    initialization: "ready", payloadCarrier: int32Carrier });
  const context = { usedAliases: new Set() };
  assert.equal(storage.kind, "copy");
  assert.equal(native.holderCarrier === int32Carrier, true, "the proven scalar field is its exact unchanged native payload");
  assert.equal(rustCapturedFieldType(native, context).name, "i32", "the exact admitted scalar type needs no storage wrapper");
  assert.equal(createRustCapturedField(native, next, context) === next, true);
  assert.equal(readRustCapturedField(storage, owner, int32Carrier) === owner, true);
  assert.equal(writeRustCapturedField(storage, owner, next), undefined);
  const retained = readRustProjectObjectFieldOwner(owner, "value", { kind: "shared-immutable" }, storage);
  assert.equal(countNodes(retained, node => node.method === "clone" || node.path === "alloc::rc::Rc::new"), 0);
  assert.equal(selectRustCapturedFieldStorage(int32Carrier, true, false, false).kind, "cell");
  assert.equal(selectRustCapturedFieldStorage(int32Carrier, true, true, true).kind, "shared");
  assert.equal(selectRustCapturedFieldStorage(stringCarrier, true, false, true).kind, "shared");
  assert.equal(selectRustCapturedFieldStorage(int32Carrier, false, false, true).kind, "cell");
});

function countNodes(expression, predicate) {
  if (expression === undefined || expression === null || typeof expression !== "object") return 0;
  return Number(predicate(expression)) + Object.values(expression).reduce((total, value) => total +
    (Array.isArray(value) ? value.reduce((sum, child) => sum + countNodes(child, predicate), 0) : countNodes(value, predicate)), 0);
}

test("RefCell whole replacements release the native write guard before discarding the old payload", () => {
  const written = rustBindingStorageOperations("borrow-cell").write(owner, next);
  assert.equal(written.kind, "block");
  assert.equal(written.body.statements.length, 1);
  const discard = written.body.statements[0];
  assert.equal(discard.kind, "let");
  assert.equal(discard.name, "_");
  assert.equal(discard.init.kind, "method-call");
  assert.equal(discard.init.method, "replace");
  assert.equal(discard.init.receiver === owner, true, "same exact owner");
  assert.equal(discard.init.args[0] === next, true, "single exact replacement");
  assert.equal(countNodes(written, node => node.method === "borrow_mut" || node.method === "clone"), 0);
});

test("projected non-Copy replacement evaluates receiver and RHS once before the scoped guard", () => {
  const selectedOwner = { kind: "path", path: "selected" };
  const replacement = { kind: "call", path: "replace", args: [] };
  const written = writeRustCapturedField({ kind: "borrow-cell", initialization: "ready" }, selectedOwner, replacement, ["inner", "value"]);
  assert.equal(written.kind, "block");
  assert.equal(written.body.statements.length, 2);
  const selected = written.body.statements[0];
  assert.equal(selected.init.elements[0].expr === selectedOwner, true, "receiver resolves outside its local name");
  assert.equal(selected.init.elements[1] === replacement, true, "RHS executes before borrow_mut");
  const discarded = written.body.statements[1];
  assert.equal(discarded.name, "_");
  assert.equal(discarded.init.kind, "block");
  const borrowed = discarded.init.body.statements[0];
  assert.equal(borrowed.init.method, "borrow_mut");
  const replace = discarded.init.body.statements[1].expr;
  assert.equal(replace.path, "core::mem::replace");
  assert.equal(replace.args[0].mutable, true);
  assert.equal(replace.args[0].expr.name, "value");
  assert.equal(replace.args[0].expr.receiver.name, "inner");
  assert.equal(countNodes(written, node => node === replacement), 1);
  assert.equal(countNodes(written, node => node.method === "clone"), 0);
});

test("deferred payload replacement retains the exact initialization guard without constructing another owner", () => {
  const written = writeRustCapturedField({ kind: "borrow-cell", initialization: "deferred" }, owner, next);
  assert.equal(written.body.statements[0].init.receiver.method, "expect");
  assert.equal(written.body.statements[0].init.receiver.receiver.method, "get");
  assert.equal(countNodes(written, node => node.path === "alloc::rc::Rc::new" || node.path === "core::cell::OnceCell::new"), 0);
});

test("mutable outer storage releases its borrow before the retained non-Copy replacement", () => {
  const receiver = { kind: "path", path: "receiver" };
  const written = writeRustProjectObjectField(receiver, "payload", "=", next, { kind: "shared-mutable" },
    { kind: "borrow-cell", initialization: "ready" });
  const replace = written.body.statements[0].init;
  assert.equal(replace.method, "replace");
  assert.equal(replace.receiver.method, "with");
  assert.equal(replace.receiver.args[0].body.method, "clone");
  assert.equal(replace.args[0] === next, true);
  assert.equal(countNodes(written, node => node.method === "clone"), 1, "only required owner survives the outer borrow");
  assert.equal(countNodes(written, node => node.method === "with_mut"), 0);
});

test("Copy Cell and immutable outer storage add no retained-owner clone", () => {
  for (const kind of ["cell", "borrow-cell"]) {
    const written = writeRustProjectObjectField(owner, "payload", "=", next, { kind: "shared-immutable" },
      { kind, initialization: "ready" });
    assert.equal(written.method, "with");
    assert.equal(countNodes(written, node => node.method === "clone"), 0, kind);
  }
  const written = writeRustProjectObjectField(owner, "payload", "=", next, { kind: "shared-mutable" },
    { kind: "cell", initialization: "ready" });
  assert.equal(written.method, "with");
  assert.equal(countNodes(written, node => node.method === "clone"), 0);
});

test("shared readonly storage never manufactures a mutable replacement", () => {
  assert.equal(writeRustCapturedField({ kind: "shared", initialization: "ready" }, owner, next), undefined);
  assert.equal(writeRustCapturedFieldFromStorage({ kind: "shared", initialization: "deferred" }, project => project(owner), next, true), undefined);
});

test("instantiated Copy reads from generic RefCell storage do not clone payloads", () => {
  const storage = { kind: "borrow-cell", initialization: "ready" };
  const copied = readRustCapturedField(storage, owner, int32Carrier);
  const cloned = readRustCapturedField(storage, owner, stringCarrier);
  assert.equal(countNodes(copied, node => node.method === "clone"), 0);
  assert.equal(countNodes(copied, node => node.kind === "dereference"), 1);
  assert.equal(countNodes(cloned, node => node.method === "clone"), 1);
});

test("borrowed structural reads require exact plain stored fields, not dispatch or accessor inference", () => {
  const carrier = {};
  const field = { storageIndex: 0, storage: "stored" };
  function context(definition, selected = field) {
    return { input: { program: { structuralShapes: { definitionForCarrier: () => definition, field: () => selected } } } };
  }
  assert.equal(rustStoredObjectFieldSupportsBorrowedRead("structural-object", carrier, 0, context({ fields: [field] })), true);
  for (const changed of [undefined, { ...field, storage: "property" }, { ...field, storage: "bound" },
    { ...field, nativeLayout: {} }, { ...field, method: true }]) {
    const selected = context({ fields: [field] });
    selected.input.program.structuralShapes.field = () => changed;
    assert.equal(rustStoredObjectFieldSupportsBorrowedRead("structural-object", carrier, 0, selected), false);
  }
  assert.equal(rustStoredObjectFieldSupportsBorrowedRead("structural-object", carrier, 0, context(undefined)), false);
  assert.equal(rustStoredObjectFieldSupportsBorrowedRead("structural-object", carrier, 0,
    context({ fields: [field], dispatchName: "Dispatch" })), false);
});

test("analysis validates exact captured storage facts against the canonical override-family declaration", () => {
  const declaration = {};
  const canonical = {};
  const fact = { storage: { kind: "borrow-cell", initialization: "deferred" }, valueCarrier: int32Carrier };
  const generic = { kind: "type-parameter", name: "Value", identity: "source:Value" };
  const captures = { isCaptured: () => true, storageDeclaration: () => canonical, storageReadonly: () => false,
    storageImmutable: () => false, isDeferred: () => true };
  function admission(selectedFact, selectedCaptures = captures, valueCarrier = int32Carrier, storageCarrier = generic) {
    let open = true;
    const producer = createRustCapturedFieldStorageProducer(() => {
      if (!open) throw new Error("The captured-field producer is sealed.");
    }, selectedFact === undefined ? undefined : { get: selected => selected === declaration ? selectedFact : undefined });
    const semantics = { sourceFile: {} };
    const requiredRecords = [];
    const context = { requiredRecords, diagnostics: [], ast: {
      kind: selected => selected === declaration || selected === canonical ? 1 : undefined,
      kindName: () => "KindIdentifier", getSourceFile: () => undefined,
      is: { IsTypeAliasDeclaration: () => false, IsInterfaceDeclaration: () => false,
        IsTypeParameterDeclaration: () => false, IsVariableDeclaration: () => false,
        IsArrayLiteralExpression: () => false, IsCallExpression: () => false },
    },
    source: { sourceFacts: { getFact: (selected, key) => key === fieldFactKey &&
      (selected !== declaration && selected !== canonical || selected === canonical && storageCarrier === undefined)
      ? { type: undefined } : undefined }, navigation: { referenceFor: () => undefined } },
    sourceStorage: { storageSubjectFor: node => ({ kind: "resolved", subject: { kind: "value", node, projection: [] } }) },
    semanticsFor: () => semantics,
    records: createRustRecordFixture({ capturedFieldStorage: producer.records,
      runtimeCarrier: { get: selected => selected === canonical ? storageCarrier === undefined ? undefined : { carrier: storageCarrier }
        : selected === declaration ? { carrier: valueCarrier } : undefined } }),
    objectRepresentations: { receiverCaptures: selectedCaptures } };
    const walk = { context, operationOptions: {}, rejectedExpressions: new WeakSet(), resolving: new Set() };
    return { producer, context, requiredRecords,
      resolve: () => producer.resolve(walk, declaration, valueCarrier),
      seal: () => { open = false; } };
  }
  const inherited = admission(fact);
  inherited.resolve();
  assert.equal(inherited.producer.records.get(declaration) === fact, true, "admission preserves exact inherited identity");
  const missingFact = admission(undefined);
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, missingFact.context), undefined, "an absent record is not fabricated by a read");
  requireRustRecord(missingFact.requiredRecords, "capturedFieldStorage", declaration, "captured-field", "capturedFieldStoragePlans.resolve");
  assert.throws(() => assertRustRequiredRecords(missingFact.context.records, missingFact.requiredRecords),
    /Required Rust semantic plan 'capturedFieldStorage'/u, "the seal refuses a missing required admission");
  missingFact.resolve();
  assert.equal(missingFact.producer.records.get(declaration) !== undefined, true, "the sole producer materializes a new valid record");
  for (const selected of [{ ...fact, unrelated: true }, { ...fact, valueCarrier: stringCarrier },
    { ...fact, storage: { kind: "cell", initialization: "deferred" } },
    { ...fact, storage: { ...fact.storage, initialization: "ready" } },
    { ...fact, storage: { ...fact.storage, unchecked: true } }]) {
    assert.throws(() => admission(selected).resolve(), /Conflicting Rust semantic plan/u,
      "malformed inherited records are rejected at canonical admission");
  }
  assert.throws(() => admission(fact, { ...captures, isCaptured: () => false }).resolve(),
    /no exact captured source declaration/u, "a foreign non-captured record is not admitted");
  assert.throws(() => admission(fact, { ...captures, storageReadonly: () => true, storageImmutable: () => true }).resolve(),
    /Conflicting Rust semantic plan/u, "canonical readonly and immutable flags must match");
  assert.throws(() => admission(fact, captures, int32Carrier, int32Carrier).resolve(), /Conflicting Rust semantic plan/u,
    "instantiated Copy cannot replace the generic declaration's physical storage");
  assert.throws(() => admission(fact, { ...captures, storageDeclaration: () => ({}) }).resolve(),
    /no exact captured source declaration/u,
    "canonical override-family owner identity is required");
  const readonly = { ...fact, storage: { kind: "shared", initialization: "ready" } };
  const readonlyAdmission = admission(readonly,
    { ...captures, storageReadonly: () => true, storageImmutable: () => true, isDeferred: () => false });
  readonlyAdmission.resolve();
  assert.equal(readonlyAdmission.producer.records.get(declaration) === readonly, true, "the readonly native selection is retained");
  const ready = { ...fact, storage: { kind: "borrow-cell", initialization: "ready" } };
  const readyAdmission = admission(ready, { ...captures, isDeferred: () => false });
  readyAdmission.resolve();
  assert.equal(readyAdmission.producer.records.get(declaration) === ready, true, "the ready native selection is retained");
  const copied = { storage: { kind: "copy", initialization: "ready" }, valueCarrier: int32Carrier };
  const copiedCaptures = { ...captures, storageReadonly: () => true, storageImmutable: () => true, isDeferred: () => false };
  const copyAdmission = admission(copied, copiedCaptures, int32Carrier, int32Carrier);
  copyAdmission.resolve();
  assert.equal(copyAdmission.producer.records.get(declaration) === copied, true, "the exact native Copy selection is retained");
  for (const selection of [{ ...copiedCaptures, storageImmutable: () => false },
    { ...copiedCaptures, storageReadonly: () => false }, { ...copiedCaptures, isDeferred: () => true }]) {
    assert.throws(() => admission(copied, selection, int32Carrier, int32Carrier).resolve(), /Conflicting Rust semantic plan/u,
      "each Copy eligibility condition remains mandatory");
  }
  assert.throws(() => admission({ ...copied, storage: { kind: "copy", initialization: "deferred" } }, copiedCaptures,
    int32Carrier, int32Carrier).resolve(), /Conflicting Rust semantic plan/u, "Copy cannot acquire deferred initialization");
  const missingCarrier = admission(fact);
  missingCarrier.context.source.sourceFacts.getFact = (selected, key) =>
    selected === canonical && key === fieldFactKey ? { type: undefined } : undefined;
  assert.throws(() => missingCarrier.resolve(), /no exact captured source declaration/u, "a missing canonical carrier blocks admission");
  assert.equal(missingCarrier.context.diagnostics[0]?.code, "RUST_CAPTURED_FIELD_STORAGE_NOT_CLOSED",
    "the original source diagnostic identifies the missing physical declaration carrier");
  let reads = 0;
  const accessor = { ...fact };
  Object.defineProperty(accessor, "storage", { enumerable: true, get() { reads++; return fact.storage; } });
  assert.throws(() => admission(accessor).resolve(), /Conflicting Rust semantic plan/u, "accessors never enter the stored-data family");
  assert.equal(reads, 0, "admission never executes a fact accessor");
  inherited.seal();
  inherited.context.objectRepresentations = { get receiverCaptures() { throw new Error("post-seal capture decision"); } };
  inherited.context.records = { ...inherited.context.records,
    runtimeCarrier: { get() { throw new Error("post-seal carrier resolution"); } } };
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, inherited.context) === fact, true,
    "the pure sealed reader retains the exact admitted record without recomputation");
  assert.throws(() => inherited.resolve(), /producer is sealed/u, "no write can occur after publication");
});
