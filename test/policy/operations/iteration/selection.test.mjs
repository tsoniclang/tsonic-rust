import assert from "node:assert/strict";
import test from "node:test";
import { rustIterableTargetPolicy, selectRustIterationLowering } from "../../../../dist/policy/operations/iteration/index.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustAsyncGeneratorTargetType, rustFixedArrayTargetType, rustGeneratorTargetType, rustJsArrayTargetType,
  rustJsMapTargetType, rustJsSetTargetType, rustJsRegExpExecArrayTargetType, rustJsRegExpStringIteratorTargetId,
  rustRegExpExecArrayTargetType, rustRegExpStringIteratorTargetId, rustSourcePrimitiveTargetType,
  rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustJsArrayEntriesTargetType, rustJsArrayEntryTargetType } from "../../../../dist/target-model/types/carriers/array-entries.js";

const integer = rustSourcePrimitiveTargetType("int32");
const string = rustStringTargetType();
const unit = { kind: "unit" };
const protocol = { yieldType: integer, returnType: unit, nextType: unit };
const select = carrier => rustIterableTargetPolicy(carrier, emptyRustTypeDefinitions);
const source = (iterationKind, mechanism = "synchronous-iterator-protocol") => ({ iterationKind, mechanism: { kind: mechanism } });

test("native iterable carrier selection preserves exact array, slice, fixed-array and string forms", () => {
  for (const [carrier, input] of [
    [{ kind: "array", element: integer }, "reference"],
    [{ kind: "reference", mutable: false, referent: { kind: "slice", element: integer } }, "direct"],
    [rustFixedArrayTargetType(integer, 4), "reference"],
  ]) assert.deepEqual(select(carrier), { kind: "borrowed", elementCarrier: integer, input });
  assert.deepEqual(select(string), { kind: "owned-call", elementCarrier: string, path: "js_abi::NativeStringIterator::new" });
  assert.equal(select(integer), undefined);
  assert.equal(select(undefined), undefined);
});

test("native iterable selection preserves JS collection metadata and exact Clone requirements", () => {
  assert.deepEqual(select(rustJsArrayTargetType(integer)), { kind: "js-array", elementCarrier: integer });
  const entries = select(rustJsArrayEntriesTargetType(integer));
  assert.equal(entries.kind, "receiver-method");
  assert.equal(entries.method, "clone");
  assert.equal(rustTargetTypeRefEquals(entries.elementCarrier, rustJsArrayEntryTargetType(integer)), true);
  const map = select(rustJsMapTargetType(string, integer));
  assert.equal(map.kind, "receiver-method");
  assert.equal(map.method, "entries");
  assert.deepEqual(map.elementCarrier, { kind: "tuple", elements: [string, integer] });
  assert.deepEqual(select(rustJsSetTargetType(integer)), { kind: "receiver-method", elementCarrier: integer, method: "values" });
  const generic = { kind: "type-parameter", name: "Value", identity: "fixture.Value" };
  assert.equal(select(rustJsMapTargetType(generic, integer)), undefined, "a generic key has no invented Clone proof");
  assert.equal(select(rustJsMapTargetType(integer, generic)), undefined, "a generic value has no invented Clone proof");
  assert.equal(select(rustJsSetTargetType(generic)), undefined, "a generic element has no invented Clone proof");
});

test("native iterable selection retains both RegExp iterator identities and generator protocols", () => {
  for (const [id, expected] of [[rustRegExpStringIteratorTargetId, rustRegExpExecArrayTargetType()],
    [rustJsRegExpStringIteratorTargetId, rustJsRegExpExecArrayTargetType()]]) {
    const selected = select({ kind: "target-named", id });
    assert.equal(selected.kind, "fallible-owned");
    assert.equal(rustTargetTypeRefEquals(selected.elementCarrier, expected), true);
  }
  assert.deepEqual(select(rustGeneratorTargetType(protocol)), { kind: "sync-generator", elementCarrier: integer });
  assert.deepEqual(select(rustAsyncGeneratorTargetType(protocol)), { kind: "async-generator", elementCarrier: integer });
});

test("native lowering keeps borrowed Copy/Clone and consuming iteration distinct", () => {
  for (const iterationKind of ["for-of", "for-await-of"]) {
    for (const input of ["direct", "reference"]) for (const [elementCarrier, style] of [[integer, "copied"], [string, "cloned"]]) {
      const target = { kind: "borrowed", elementCarrier, input };
      assert.deepEqual(selectRustIterationLowering(source(iterationKind), target, false), { kind: "borrowed", style, input });
      assert.deepEqual(selectRustIterationLowering(source(iterationKind), target, true), { kind: "owned" });
    }
  }
});

test("native lowering preserves every supported iterator form and rejects incompatible mechanisms", () => {
  for (const iterationKind of ["for-of", "for-await-of"]) for (const [target, expected] of [
    [{ kind: "receiver-method", elementCarrier: integer, method: "values" }, { kind: "receiver-method", name: "values" }],
    [{ kind: "js-array", elementCarrier: integer }, { kind: "js-array" }],
    [{ kind: "owned-call", elementCarrier: string, path: "js_abi::NativeStringIterator::new" }, { kind: "owned-call", path: "js_abi::NativeStringIterator::new" }],
    [{ kind: "fallible-owned", elementCarrier: integer }, { kind: "fallible-owned" }],
    [{ kind: "sync-generator", elementCarrier: integer }, { kind: "sync-generator" }],
  ]) assert.deepEqual(selectRustIterationLowering(source(iterationKind), target, false), expected);
  const asynchronous = { kind: "async-generator", elementCarrier: integer };
  assert.equal(selectRustIterationLowering(source("for-of"), asynchronous, false), undefined);
  assert.deepEqual(selectRustIterationLowering(source("for-await-of", "asynchronous-iterator-protocol"), asynchronous, false), { kind: "async-generator" });
  assert.equal(selectRustIterationLowering(source("for-await-of"), asynchronous, false), undefined);
  for (const mechanism of ["union", "untyped-dynamic-iteration"]) {
    assert.equal(selectRustIterationLowering(source("for-of", mechanism), select({ kind: "array", element: integer }), false), undefined);
  }
  assert.equal(selectRustIterationLowering(source("for-await-of", "asynchronous-iterator-protocol"), select(string), false), undefined);
  assert.equal(selectRustIterationLowering(source("for-await-of", "asynchronous-iterator-protocol"), select({ kind: "array", element: integer }), false), undefined);
});
