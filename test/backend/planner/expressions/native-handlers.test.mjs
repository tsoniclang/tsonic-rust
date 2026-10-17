import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { planRawExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { planRustNativeHandler } from "../../../../dist/backend/planner/expressions/native-handlers.js";

test("the Rust root reads one descriptor, never probes losing applicability, and keeps zero layouts", () => {
  const node = {};
  const selected = Object.freeze({ kind: "native-pointer", selection: Object.freeze({ kind: "layout-query", observation: { value: 0 } }) });
  let reads = 0;
  const context = { input: { program: { promiseResults: new Map(), records: new Proxy({ nativeHandler: { get(subject) {
    assert.equal(subject === node, true, "the descriptor read retains its exact source subject"); reads++; return selected;
  } } }, { get(records, field) { assert.equal(field === "nativeHandler", true, `no losing query: ${String(field)}`); return records[field]; } }) } }, diagnostics: [] };
  assert.equal(isDeepStrictEqual(planRawExpression(node, context, "value"), { kind: "int-literal", text: "0usize" }), true,
    "the complete selected zero-layout AST is unchanged");
  assert.equal(reads === 1, true, "the root reads its selected descriptor exactly once");
  assert.equal(context.diagnostics.length === 0, true,
    `selected layout diagnostics; codes: ${context.diagnostics.map(({ code }) => code).join(", ")}`);
});

test("an admitted memory binding never falls through when its operand has no expression", () => {
  const operand = {};
  const handler = { kind: "memory-binding", selection: { kind: "field", expression: operand } };
  let calls = 0;
  const context = { input: { program: { promiseResults: new Map(), records: new Proxy({}, { get: (_, field) => assert.fail(`No raw applicability query: ${String(field)}`) }) } }, diagnostics: [] };
  const planned = planRustNativeHandler({}, handler, context, "discarded", node => {
    calls++; assert.equal(node === operand, true, "the selected memory operand retains source identity"); return undefined;
  });
  assert.equal(planned === undefined, true, "a failed selected operand has no expression");
  assert.equal(calls === 1, true, "the failed selected operand is visited once without fallback");
  assert.equal(context.diagnostics.length === 0, true,
    `failed selected operand diagnostics; codes: ${context.diagnostics.map(({ code }) => code).join(", ")}`);
});

test("the selected explicit safety operation keeps its original source rejection and exact node", () => {
  const node = {};
  const context = { diagnostics: [] };
  const selected = { kind: "explicit-safety", selection: { kind: "safety-builder", fact: { kind: "builder-state" } } };
  assert.equal(planRustNativeHandler(node, selected, context, "value", () => assert.fail("a rejected safety marker has no operand")) === undefined, true,
    "the selected safety builder preserves its source rejection");
  assert.equal(context.diagnostics.length === 1, true, "the selected safety builder emits exactly one diagnostic");
  assert.equal(context.diagnostics[0].code === "RUST_SAFETY_MARKER_RUNTIME_POSITION_UNSUPPORTED", true,
    `the original safety source code is retained: ${context.diagnostics[0].code}`);
  assert.equal(context.diagnostics[0].sourceNode === node, true, "the rejection retains the original source node");
});
