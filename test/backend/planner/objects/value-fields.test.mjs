import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planRustValueFieldLocation } from "../../../../dist/backend/planner/objects/value-fields.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

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
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "source-field") fields.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(fields.length, 3);
  const storage = { kind: "path", path: "prepared_field" };
  const value = { kind: "int-literal", text: "9" };
  for (const { node, fact } of fields) {
    const context = (override, facts = program.facts) => ({
      input: { program: { ...program, facts } }, diagnostics: [], sourceFile: ast.getSourceFile(node),
      syntheticNames: createRustSyntheticNameState(ast, node, []),
      expressionOverrides: new Map([[node, override]]),
    });
    const override = { expression: storage, carrier: fact.resultCarrier, valueForm: "storage" };
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
    ]) {
      const rejected = context(changed);
      assert.equal(planRustValueFieldLocation(node, rejected, "write") === undefined, true, changed.valueForm);
      assert.equal(rejected.diagnostics.some(row => row.code === "RUST_MISSING_TARGET_FACT"), true);
    }
    const missing = context(override, { ...program.facts, getSelectedTargetProperty: () => undefined });
    assert.equal(planRustValueFieldLocation(node, missing, "write") === undefined, true, "selected property evidence is required");
  }
});
