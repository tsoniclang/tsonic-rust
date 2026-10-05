import assert from "node:assert/strict";
import test from "node:test";
import { nullableStructuralResultFiles } from "../../../../tsonic/test/fixtures/nullable-structural-results.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`nullable structural and class results preserve selected storage on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: nullableStructuralResultFiles });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => `${row.code}: ${row.message.slice(0, 256)}`).join("\n"));
    validateGeneratedProject(`nullable-structural-results-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
