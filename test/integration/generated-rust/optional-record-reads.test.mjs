import assert from "node:assert/strict";
import test from "node:test";
import { optionalRecordReadsSource } from "../../../../tsonic/test/fixtures/optional-record-reads.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`optional record reads retain selected results and lazy keys on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": optionalRecordReadsSource +
        '\nexport function main(): void { if (!run()) throw new Error("optional record reads"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject("optional-record-reads", result.artifacts, { run: true });
  });
}
