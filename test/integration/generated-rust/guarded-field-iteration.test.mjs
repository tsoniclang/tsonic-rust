import assert from "node:assert/strict";
import test from "node:test";
import { guardedFieldIterationFiles } from "../../../../tsonic/test/fixtures/guarded-field-iteration.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`guarded cross-file fields retain exact array iteration in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: guardedFieldIterationFiles });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => `${row.code}: ${row.message.slice(0, 256)}`).join("\n"));
    validateGeneratedProject(`guarded-field-iteration-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
