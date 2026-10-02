import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nullishResultConversionsSource } from "../../../../tsonic/test/fixtures/nullish-result-conversions.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`nullish results retain their native carrier before destination conversion (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": nullishResultConversionsSource + '\nexport function main(): void { if (!run()) throw new Error("nullish result conversion"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("nullish-result-conversions", result.artifacts, { run: true });
  });
}
