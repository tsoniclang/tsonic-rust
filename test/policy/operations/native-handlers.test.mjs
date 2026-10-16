import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNativeHandler } from "../../../dist/policy/operations/pointers/native-handlers.js";
import { selectRustNativePointerOperation } from "../../../dist/policy/operations/pointers/native-pointers.js";

test("Rust adapts the same five native roots with exact payloads and memory-first priority", () => {
  const memory = Object.freeze({ kind: "field" });
  const safety = Object.freeze({ kind: "unsafe-context" });
  const provider = Object.freeze({ kind: "provider-operation", operationId: "not-a-spelling-test" });
  const pointer = Object.freeze({ kind: "layout-query", observation: { value: 0 } });
  const operation = Object.freeze({ kind: "typed-location" });
  const plan = Object.freeze({ operation: "load" });
  const kinds = ["memory-binding", "explicit-safety", "js-string-conversion", "native-pointer", "typed-location"];
  for (const [index, kind] of kinds.entries()) {
    const selected = selectRustNativeHandler(index === 0 ? memory : undefined, index <= 1 ? safety : undefined,
      index <= 2 ? { kind: "call-marker", marker: "js-string" } : undefined,
      index <= 2 ? provider : operation, pointer, plan);
    const chosen = index === 4 ? selectRustNativeHandler(undefined, undefined, undefined, operation, undefined, plan) : selected;
    assert.equal(chosen.kind, kind);
    assert.equal(Object.isFrozen(chosen), true);
    const exact = index === 0 ? memory : index === 1 ? safety : index === 2 ? provider : pointer;
    if (index === 4) {
      assert.equal(chosen.selection.operation === operation && chosen.selection.plan === plan, true);
      assert.equal(Object.isFrozen(chosen.selection), true);
    } else assert.equal(chosen.selection === exact, true, kind);
  }
  assert.equal(selectRustNativeHandler(undefined, undefined, undefined, undefined, undefined, undefined) === undefined, true);
});

test("only the exact JS call marker selects the existing provider ABI, never its name or generated path", () => {
  const operation = Object.freeze({ kind: "provider-operation", operationId: "tsonic.rust.js.jsstr",
    abi: { target: { path: "js_abi::js_string_from_utf8" } } });
  for (const marker of [undefined, { kind: "type-marker", marker: "js-string" }, { kind: "call-marker", marker: "default-value" }]) {
    assert.equal(selectRustNativeHandler(undefined, undefined, marker, operation, undefined, undefined) === undefined, true);
  }
  const selected = selectRustNativeHandler(undefined, undefined, { kind: "call-marker", marker: "js-string" }, operation, undefined, undefined);
  assert.equal(selected.kind, "js-string-conversion");
  assert.equal(selected.selection === operation, true);
});

test("raw, layout, address and identity are pointer payloads, never extra root categories", () => {
  const raw = Object.freeze({ operation: "to-raw" });
  const layout = Object.freeze({ value: 0 });
  const address = Object.freeze({ method: "address" });
  const identity = Object.freeze({ method: "same" });
  const native = Object.freeze({ kind: "native-pointer", operation: "load" });
  const cases = [
    ["raw-location", [raw, layout, address, native], "plan", raw],
    ["layout-query", [undefined, layout, address, native], "observation", layout],
    ["raw-address", [undefined, undefined, address, native], "plan", address],
    ["raw-identity", [undefined, undefined, identity, native], "plan", identity],
    ["native-pointer", [undefined, undefined, undefined, native], "operation", native],
  ];
  for (const [kind, inputs, field, payload] of cases) {
    const selected = selectRustNativePointerOperation(...inputs);
    assert.equal(selected.kind, kind);
    assert.equal(selected[field] === payload, true, kind);
    assert.equal(Object.isFrozen(selected), true, kind);
    const root = selectRustNativeHandler(undefined, undefined, undefined, undefined, selected, undefined);
    assert.equal(root.kind, "native-pointer");
    assert.equal(root.selection === selected, true);
  }
  assert.equal(selectRustNativePointerOperation(undefined, undefined, undefined, undefined) === undefined, true);
});
