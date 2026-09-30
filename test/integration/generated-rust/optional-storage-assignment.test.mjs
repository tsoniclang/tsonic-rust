import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { optionalStorageAssignmentSource } from "../../../../tsonic/test/fixtures/optional-storage-assignment.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`optional field declarations retain native absence, widths and identity (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": optionalStorageAssignmentSource + '\nexport function main(): void { if (!run()) throw new Error("optional storage assignment"); }' } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`optional-storage-assignment-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
