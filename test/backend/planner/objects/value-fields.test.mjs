import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planRustValueFieldLocation } from "../../../../dist/backend/planner/objects/value-fields.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustStoredFields } from "../../../../dist/analysis/storage/stored-fields.js";
import { createRustStoredFieldProducer } from "../../../../dist/analysis/program/records/stored-fields.js";

test("prepared native field locations retain exact storage and reject copied or mismatched roots", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
class Value {
  count: number;
  constructor(count: number) { this.count = count; this.count++; }
}
export function run(): number { const value = new Value(4); return value.count; }
` } });
  const { ast } = program.source;
  const fields = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "source-field") fields.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(fields.length, 3);
  const storage = { kind: "path", path: "prepared_field" };
  const value = { kind: "int-literal", text: "9" };
  for (const { node, fact } of fields) {
    const context = (override, records = program.records) => ({
      input: { program: { ...program, records } }, diagnostics: [], sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined,
      syntheticNames: createRustSyntheticNameState(ast, node, []),
      expressionOverrides: new Map([[node, override]]),
    });
    const override = { expression: storage, carrier: fact.resultCarrier, valueForm: "storage", storageForm: "plain" };
    for (const access of ["read", "write"]) {
      const accepted = context(override);
      const location = planRustValueFieldLocation(node, accepted, access);
      assert.equal(location !== undefined, true, access);
      assert.equal(accepted.diagnostics.length, 0);
      assert.equal(location.bindings.length, 0);
      assert.equal(location.read === storage, true, "the prepared scalar is not projected again");
      assert.equal(location.withRead(selected => selected) === storage, true, "a scoped read does not copy the owner");
      assert.deepEqual(location.write(value, accepted), { kind: "assignment", operator: "=", target: storage, value });
    }
    for (const changed of [
      { ...override, valueForm: "value" },
      { ...override, valueForm: "shared-reference" },
      { ...override, carrier: rustSourcePrimitiveTargetType("bool") },
      { ...override, storageForm: "borrow-guard" },
    ]) {
      const rejected = context(changed);
      assert.equal(planRustValueFieldLocation(node, rejected, "write") === undefined, true, changed.valueForm);
      assert.equal(rejected.diagnostics.length, 0, "an inapplicable native location is not a second source rejection");
    }
    const missing = context(override, createRustRecordFixture({
admittedField: { get: () => undefined }}, program.records));
    assert.equal(planRustValueFieldLocation(node, missing, "write") === undefined, true, "selected property evidence is required");
    assert.equal(missing.diagnostics.length, 0);
    const missingSelected = { ...program, records: createRustRecordFixture({
      selectedOperation: { get: subject => subject === node ? undefined : program.records.selectedOperation.get(subject) },
    }, program.records) };
    assert.throws(() => analyzeRustStoredFields(missingSelected, [node], createRustStoredFieldProducer(() => {})),
      error => error?.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" &&
        error.diagnostic.sourceNode === node && error.diagnostic.message ===
          "A source field requires its exact selected native operation and optional result correspondence.",
      "the original missing-selected-property case is rejected at its actual pre-seal owner");
  }
});
