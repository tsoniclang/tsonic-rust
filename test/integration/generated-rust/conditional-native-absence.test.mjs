import assert from "node:assert/strict";
import test from "node:test";
import { conditionalNativeAbsenceSource } from "../../../../tsonic/test/fixtures/conditional-native-absence.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`conditional native results retain complete absence and uint64 domains on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": conditionalNativeAbsenceSource +
        '\nexport function main(): void { if (!run()) throw new Error("conditional native absence"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject("conditional-native-absence", result.artifacts, { run: true });
  });
}
