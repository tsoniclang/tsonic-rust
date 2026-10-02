import assert from "node:assert/strict";
import test from "node:test";
import { absenceCallableConversionSource, broadCallableConversionSource } from "../../../../tsonic/test/fixtures/callable-conversion-evaluation.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`stored and factory-produced absence callbacks bind once in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": absenceCallableConversionSource + '\nexport function main(): void { if (!run()) throw new Error("callable conversion"); }' } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`absence-callable-conversion-${lane}`, result.artifacts, { run: true });
  });
}

test("stored and factory-produced broad callbacks bind once on the JS surface", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": broadCallableConversionSource + '\nexport function main(): void { if (!run()) throw new Error("broad callable conversion"); }' } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("broad-callable-conversion", result.artifacts, { run: true });
});
