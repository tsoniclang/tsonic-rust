import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { partialNativeGuardsSource } from "../../../../tsonic/test/fixtures/partial-native-guards.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`partial native guards preserve stronger checked evidence on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": partialNativeGuardsSource + '\nexport function main(): void { if (!run()) throw new Error("partial native guards"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("partial-native-guards", result.artifacts, { run: true });
  });
}
