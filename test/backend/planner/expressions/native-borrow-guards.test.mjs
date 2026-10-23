import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { planRustSharedReceiver } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { applyRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { rustStringTargetType } from "../../../../dist/target-model/types/index.js";

const carrier = rustStringTargetType();
const node = {};
const declaration = {};
const borrowed = { kind: "borrow", mutable: false };

function context(storage, override, ownership = borrowed) {
  return {
    capturedBindings: [],
    expressionOverrides: new Map(override === undefined ? [] : [[node, override]]),
    input: { program: {
      source: { ast: { kindName: () => "KindIdentifier" } },
      records: createRustRecordFixture({
        sourceBinding: { get: () => ({ sourceDeclaration: declaration }) },
        bindingStorage: { get: () => storage === undefined ? undefined : { storage, valueCarrier: carrier } },
        readOwnership: { get: () => ({ carrier, source: ownership, value: ownership,
          snapshot: undefined, stablePlace: true, readsStorage: true, pure: true,
          sharedReference: false, borrowedAcross: new Set() }) },
      }),
    } },
  };
}

test("a selected RefCell read retains the guard dereference in its native shared borrow", () => {
  const receiver = { kind: "call", path: "next_owner", args: [] };
  const guard = { kind: "method-call", receiver, method: "borrow", args: [] };
  const value = { kind: "dereference", pointer: guard };
  const planned = planRustSharedReceiver(node, value, context("borrow-cell"));
  assert.equal(planned.kind, "reference", "the AsRef input is a native payload reference");
  assert.equal(planned.expr === value, true, "retain &*guard rather than the Ref guard itself");
  assert.equal(planned.expr.pointer === guard, true, "the exact selected borrow operation occurs once");
  assert.equal(guard.receiver === receiver, true, "the original receiver evaluation is not replanned");
});

test("a selected borrowed array element keeps the same guarded place for native input shaping", () => {
  const pointer = { kind: "path", path: "element" };
  const value = { kind: "dereference", pointer };
  const override = { expression: value, carrier, valueForm: "storage", storageForm: "borrow-guard" };
  const planned = planRustSharedReceiver(node, value, context(undefined, override));
  assert.equal(planned.kind, "reference", "native element payload is borrowed");
  assert.equal(planned.expr === value, true, "the guard is not substituted for its payload place");
  assert.equal(planned.expr.pointer === pointer, true, "one selected element guard");
});

test("ordinary native references retain reference elision without a guard or clone", () => {
  const pointer = { kind: "path", path: "reference" };
  const value = { kind: "dereference", pointer };
  const override = { expression: value, carrier, valueForm: "storage", storageForm: "plain" };
  const planned = planRustSharedReceiver(node, value, context(undefined, override));
  assert.equal(planned === pointer, true, "native &T remains the existing reference, not &*reference");
  const copied = planRustSharedReceiver(node, value, context(undefined, override, { kind: "copy" }));
  assert.equal(copied.kind, "reference", "a non-borrowing native place is explicitly borrowed");
  assert.equal(copied.expr === value, true, "a genuine place is not globally unwrapped");
});

test("a finalized conversion never reads an original guarded source or discards the converted value", () => {
  const expression = { kind: "call", path: "convert_once", args: [] };
  const selected = { input: { program: {
    get records() { assert.fail("finalized native values have no source-storage authority"); },
  } } };
  for (const mode of ["ref", "mut-ref"]) {
    const planned = applyRustArgumentMode(selected, { stage: "finalized", expression }, mode);
    assert.equal(planned.kind, "reference", "borrow the selected final value");
    assert.equal(planned.expr === expression, true, "conversion and effects survive exactly once");
    assert.equal(planned.mutable === true, mode === "mut-ref", "native input mode is unchanged");
  }
});
