import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { planRawExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { planRustNativeHandler } from "../../../../dist/backend/planner/expressions/native-handlers.js";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { Node_Expression } from "@tsonic/target-api/source";

test("the Rust root reads one descriptor, never probes losing applicability, and keeps zero layouts", () => {
  const node = {};
  const selected = Object.freeze({ kind: "native-pointer", selection: Object.freeze({ kind: "layout-query", observation: { value: 0 } }) });
  let reads = 0;
  let exits = 0;
  let discards = 0;
  const records = {
    expressionExit: { get(subject) {
      assert.equal(subject === node, true, "the mandatory exit record retains its exact subject"); exits++; return undefined;
    } },
    nativeHandler: { get(subject) {
      assert.equal(subject === node, true, "the descriptor read retains its exact source subject"); reads++; return selected;
    } },
    promiseResult: { get(subject) {
      assert.equal(subject === node, true, "the mandatory discard record retains its exact subject"); discards++; return undefined;
    } },
  };
  const context = { input: { program: { records: new Proxy(records, { get(records, field) {
    assert.equal(Object.hasOwn(records, field), true, `no losing query: ${String(field)}`); return records[field];
  } }) } }, diagnostics: [] };
  assert.equal(isDeepStrictEqual(planRawExpression(node, context, "value"), { kind: "int-literal", text: "0usize" }), true,
    "the complete selected zero-layout AST is unchanged");
  assert.equal(reads === 1, true, "the root reads its selected descriptor exactly once");
  assert.equal(exits, 1, "the required native exit composition is read exactly once");
  assert.equal(discards, 1, "the required native discard composition is read exactly once");
  assert.equal(context.diagnostics.length === 0, true,
    `selected layout diagnostics; codes: ${context.diagnostics.map(({ code }) => code).join(", ")}`);
});

test("an admitted memory binding never falls through when its operand has no expression", () => {
  const operand = {};
  const handler = { kind: "memory-binding", selection: { kind: "field", expression: operand } };
  let calls = 0;
  const context = { input: { program: { records: new Proxy({}, { get: (_, field) => assert.fail(`No raw applicability query: ${String(field)}`) }) } }, diagnostics: [] };
  const planned = planRustNativeHandler({}, handler, context, "discarded", node => {
    calls++; assert.equal(node === operand, true, "the selected memory operand retains source identity"); return undefined;
  });
  assert.equal(planned === undefined, true, "a failed selected operand has no expression");
  assert.equal(calls === 1, true, "the failed selected operand is visited once without fallback");
  assert.equal(context.diagnostics.length === 0, true,
    `failed selected operand diagnostics; codes: ${context.diagnostics.map(({ code }) => code).join(", ")}`);
});

test("explicit safety rejection retains its original source diagnostic before any program is published", () => {
  const { source, result } = compileRust({ files: { "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
export function selected(value: int32): int32 { return value; }
safety(selected);
` } });
  assert.equal(result.diagnostics.length, 1, "the actual incomplete builder has exactly one original source diagnostic");
  const issue = result.diagnostics[0];
  assert.equal(issue.code, "RUST_SAFETY_MARKER_RUNTIME_POSITION_UNSUPPORTED", "the source code is unchanged");
  assert.equal(issue.message, "Rust declaration safety markers must be complete standalone expression statements.");
  const file = source.ast.getSourceFile(issue.sourceNode);
  let node;
  const visit = subject => {
    if (source.ast.is.IsCallExpression(subject)) {
      const callee = Node_Expression(source.ast, subject);
      if (callee !== undefined && source.ast.is.IsIdentifier(callee) && source.ast.text(callee) === "safety") node = subject;
    }
    source.ast.forEachChild(subject, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  assert.equal(node !== undefined && issue.sourceNode === node, true, "the pre-seal rejection retains the exact original marker call");
  assert.equal(result.program === undefined, true, "the incomplete safety builder publishes no analysis program");
  assert.equal(result.plan === undefined, true, "there is no planner invocation for invalid safety source");
  assert.equal(result.artifacts.length, 0, "there is no emitted native artifact");
  const context = { diagnostics: [] };
  const selected = { kind: "explicit-safety", selection: { kind: "safety-builder", fact: { kind: "builder-state" } } };
  let operands = 0;
  assert.throws(() => planRustNativeHandler(node, selected, context, "value", () => { operands++; return undefined; }),
    error => error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" && error.diagnostic.sourceNode === node &&
      error.diagnostic.message === "An admitted unsafe expression requires its exact source operand and placement.",
    "a forged late handler is an internal invariant, never a second source-rejection owner");
  assert.equal(operands, 0, "the invalid handler never evaluates an operand or falls back");
  assert.equal(context.diagnostics.length, 0, "the native renderer does not duplicate the pre-seal source diagnostic");
});
