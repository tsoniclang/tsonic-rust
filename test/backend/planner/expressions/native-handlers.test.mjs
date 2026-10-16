import assert from "node:assert/strict";
import test from "node:test";
import { planRawExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { planRustNativeHandler } from "../../../../dist/backend/planner/expressions/native-handlers.js";

test("the Rust root reads one descriptor, never probes losing applicability, and keeps zero layouts", () => {
  const node = {};
  const selected = Object.freeze({ kind: "native-pointer", selection: Object.freeze({ kind: "layout-query", observation: { value: 0 } }) });
  let reads = 0;
  const context = { input: { program: { records: new Proxy({ nativeHandler: { get(subject) {
    assert.equal(subject === node, true); reads++; return selected;
  } } }, { get(records, field) { assert.equal(field === "nativeHandler", true, `no losing query: ${String(field)}`); return records[field]; } }) } }, diagnostics: [] };
  assert.deepEqual(planRawExpression(node, context, "value"), { kind: "int-literal", text: "0usize" });
  assert.equal(reads, 1);
  assert.deepEqual(context.diagnostics, []);
});

test("an admitted memory binding never falls through when its operand has no expression", () => {
  const operand = {};
  const handler = { kind: "memory-binding", selection: { kind: "field", expression: operand } };
  let calls = 0;
  const context = { input: { program: { records: new Proxy({}, { get: (_, field) => assert.fail(`No raw applicability query: ${String(field)}`) }) } }, diagnostics: [] };
  const planned = planRustNativeHandler({}, handler, context, "discarded", node => {
    calls++; assert.equal(node === operand, true); return undefined;
  });
  assert.equal(planned === undefined, true);
  assert.equal(calls, 1);
  assert.deepEqual(context.diagnostics, []);
});

test("the selected explicit safety operation keeps its original source rejection and exact node", () => {
  const node = {};
  const context = { diagnostics: [] };
  const selected = { kind: "explicit-safety", selection: { kind: "safety-builder", fact: { kind: "builder-state" } } };
  assert.equal(planRustNativeHandler(node, selected, context, "value", () => assert.fail("a rejected safety marker has no operand")) === undefined, true);
  assert.equal(context.diagnostics.length, 1);
  assert.equal(context.diagnostics[0].code, "RUST_SAFETY_MARKER_RUNTIME_POSITION_UNSUPPORTED");
  assert.equal(context.diagnostics[0].sourceNode === node, true);
});
