import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { checkedAbsenceSource } from "../../../../tsonic/test/fixtures/checked-absence.mjs";

test("checked array values and loose absence tests use the canonical native absence", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": checkedAbsenceSource + '\nexport function main(): void { if (!run()) throw new Error("checked absence"); }',
    } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("checked-absence", result.artifacts, { run: true });
});
