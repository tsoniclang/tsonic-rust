import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { planRustDirectStorageCore } from "../../../../dist/backend/planner/expressions/update-direct-storage.js";
import { analyzeRustDirectStorage } from "../../../../dist/analysis/storage/direct-storage.js";
import { createRustDirectStorageProducer } from "../../../../dist/analysis/program/records/direct-storage.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";

const programs = new Map();

function fixture(storage, module = false) {
  if (!programs.has(module)) programs.set(module, analyzeRust({ files: { "index.ts": module
    ? 'export let value = "value"; export function selected(): string { return (value); }'
    : 'export function selected(): string { const value = "value"; return (value); }' } }).program);
  const program = programs.get(module);
  const { ast } = program.source;
  let parenthesized;
  const visit = node => {
    if (ast.is.IsParenthesizedExpression(node)) parenthesized = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(parenthesized !== undefined, true, "the storage fixture uses its actual checked parenthesized read");
  const node = ast.as.AsParenthesizedExpression(parenthesized).Expression;
  const binding = program.records.sourceBinding.get(node);
  assert.equal(binding !== undefined, true, "the direct-storage producer consumes the real checked binding identity");
  const declaration = binding.sourceDeclaration;
  const carrier = program.records.valueRead.get(node).source;
  const family = module ? "moduleBinding" : "bindingStorage";
  const records = createRustRecordFixture({ [family]: { get: selected => selected === declaration
    ? storage === undefined ? undefined : { ...program.records[family].get(declaration), storage, valueCarrier: carrier }
    : program.records[family].get(selected) } }, program.records);
  const producer = createRustDirectStorageProducer(() => {});
  const issues = analyzeRustDirectStorage({ ...program, records }, [node, parenthesized], producer,
    { typedLocationPlan: { get: () => undefined } });
  assert.equal(issues.length, 0, "the actual pre-seal native place owner admits the selected binding representation");
  const context = rustSourceFilePlanContext({ ...program,
    records: createRustRecordFixture(producer.records, records) }, node);
  return { node, parenthesized, declaration, carrier, context };
}

function selected(node, context) {
  return planRustDirectStorageCore(node, context, undefined,
    () => assert.fail("direct binding selection must not replan a value"),
    () => assert.fail("direct binding selection must not invent a provider call"));
}

test("direct storage consumes finalized lexical and module binding representation", () => {
  for (const storage of ["location", "cell", "borrow-cell"]) {
    const { node, parenthesized, context } = fixture(storage);
    assert.equal(selected(node, context) === undefined, true, storage);
    assert.equal(selected(parenthesized, context) === undefined, true, storage + " parenthesized");
  }
  const { node, context } = fixture("module-cell", true);
  assert.equal(selected(node, context) === undefined, true, "module storage is not a native value place");
  const direct = fixture();
  assert.deepEqual(selected(direct.node, direct.context), { kind: "path", path: "value" });
});

test("direct storage preserves exact lexical value overrides and selected capture storage", () => {
  const { node, carrier, context } = fixture("location");
  const expression = { kind: "path", path: "selected_value" };
  assert.equal(selected(node, { ...context, expressionOverrides: new Map([[node, {
    expression, carrier, valueForm: "storage", storageForm: "plain",
  }]]) }) === expression, true, "a lexical storage override owns its physical expression");
  for (const valueForm of ["owned", "shared-reference"]) {
    assert.equal(selected(node, { ...context, expressionOverrides: new Map([[node, {
      expression, carrier, valueForm,
    }]]) }) === undefined, true, valueForm);
  }
  const captured = fixture();
  for (const storage of ["value", "location", "cell", "borrow-cell"]) {
    const capture = { declaration: captured.declaration, expression, valueCarrier: captured.carrier, storage };
    const result = selected(captured.node, { ...captured.context, capturedBindings: [capture] });
    assert.equal(result === expression, storage === "value", "the selected capture owns " + storage);
  }
});
