import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { optionalIndexedLocationSource } from "../../../../tsonic/test/fixtures/optional-indexed-locations.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`optional indexed locations retain native absence, widths and identity (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": optionalIndexedLocationSource + '\nexport function main(): void { if (!run()) throw new Error("optional indexed locations"); }' } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`optional-indexed-locations-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
