import assert from "node:assert/strict";
import test from "node:test";
import { rustBindingStorageOperations } from "../../../../dist/backend/planner/expressions/binding-storage.js";
import { readRustCapturedField, writeRustCapturedField, writeRustCapturedFieldFromStorage } from "../../../../dist/backend/planner/objects/captured-fields.js";
import { writeRustProjectObjectField } from "../../../../dist/backend/planner/objects/project-objects.js";
import { rustStoredObjectFieldSupportsBorrowedRead } from "../../../../dist/backend/planner/objects/project-storage.js";
import { validatedRustCapturedFieldStorageFact } from "../../../../dist/analysis/facts/receiver-captures.js";
import { int32Carrier, stringCarrier } from "../../../helpers/rust-session.mjs";

const owner = { kind: "path", path: "payload" };
const next = { kind: "path", path: "next" };

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
  const captures = { isCaptured: () => true, storageDeclaration: () => canonical, storageReadonly: () => false, isDeferred: () => true };
  function program(selectedFact = fact, selectedCaptures = captures, valueCarrier = int32Carrier, storageCarrier = generic) {
    return { facts: { getFact: () => selectedFact, getRuntimeCarrierFact: selected => ({ carrier: selected === canonical ? storageCarrier : valueCarrier }) },
      objectRepresentations: { receiverCaptures: selectedCaptures } };
  }
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program()) === fact, true);
  for (const selected of [undefined, { ...fact, unrelated: true }, { ...fact, valueCarrier: stringCarrier },
    { ...fact, storage: { kind: "cell", initialization: "deferred" } },
    { ...fact, storage: { ...fact.storage, initialization: "ready" } },
    { ...fact, storage: { ...fact.storage, unchecked: true } }]) {
    const input = program();
    input.facts.getFact = () => selected;
    assert.equal(validatedRustCapturedFieldStorageFact(declaration, input), undefined);
  }
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(fact, { ...captures, isCaptured: () => false })), undefined);
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(fact, { ...captures, storageReadonly: () => true })), undefined);
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(fact, captures, int32Carrier, int32Carrier)), undefined,
    "instantiated Copy cannot replace the generic declaration's physical storage");
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(fact, { ...captures, storageDeclaration: () => ({}) })), undefined,
    "canonical override-family owner identity is required");
  const readonly = { ...fact, storage: { kind: "shared", initialization: "ready" } };
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(readonly,
    { ...captures, storageReadonly: () => true, isDeferred: () => false })) === readonly, true);
  const ready = { ...fact, storage: { kind: "borrow-cell", initialization: "ready" } };
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(ready, { ...captures, isDeferred: () => false })) === ready, true);
  const missing = program();
  missing.facts.getRuntimeCarrierFact = () => undefined;
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, missing), undefined);
  let reads = 0;
  const accessor = { ...fact };
  Object.defineProperty(accessor, "storage", { enumerable: true, get() { reads++; return fact.storage; } });
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(accessor)), undefined);
  assert.equal(reads, 0);
});
