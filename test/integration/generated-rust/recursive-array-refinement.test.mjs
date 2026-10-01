import assert from "node:assert/strict";
import test from "node:test";
import { recursiveArrayRefinementSource, arrayRecordRefinementSource } from "../../../../tsonic/test/fixtures/recursive-array-refinement.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("recursive array refinement preserves native members and mutable backing identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": recursiveArrayRefinementSource + '\nexport function main(): void { if (!run()) throw new Error("recursive array refinement"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.to_vec\(|\.collect\(/u);
  validateGeneratedProject("recursive-array-refinement", result.artifacts, { run: true });
});

test("array and record narrowing retains the exact native member instead of matching its name", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": arrayRecordRefinementSource + '\nexport function main(): void { if (!run()) throw new Error("array record refinement"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.to_vec\(|\.collect\(/u);
  validateGeneratedProject("array-record-refinement", result.artifacts, { run: true });
});
