import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { recursiveArrayRefinementSource, arrayRecordRefinementSource, multipleArrayRefinementSource,
  genericArrayRefinementFiles, conflictingArrayRefinementFiles } from "../../../../tsonic/test/fixtures/recursive-array-refinement.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("recursive array refinement preserves native members and mutable backing identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": recursiveArrayRefinementSource + '\nexport function main(): void { if (!run()) throw new Error("recursive array refinement"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.to_vec\(|\.collect\(/u);
  validateGeneratedProject("recursive-array-refinement", result.artifacts, { run: true });
});

test("array and record narrowing retains the exact native member instead of matching its name", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": arrayRecordRefinementSource + '\nexport function main(): void { if (!run()) throw new Error("array record refinement"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.to_vec\(|\.collect\(/u);
  validateGeneratedProject("array-record-refinement", result.artifacts, { run: true });
});

test("multiple refined native arrays retain their exact element carriers and backing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": multipleArrayRefinementSource + '\nexport function main(): void { if (!run()) throw new Error("multiple array refinement"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.to_vec\(|\.collect\(|NumberArray|dyn Any/u);
  assert.doesNotMatch(output, /JsArray<[^>]*\bBigInt\b/u);
  validateGeneratedProject("multiple-array-refinement", result.artifacts, { run: true });
});

test("cross-file generic array union aliases preserve exact native marker arguments", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { ...genericArrayRefinementFiles, "index.ts": genericArrayRefinementFiles["index.ts"] +
      '\nexport function main(): void { if (!run()) throw new Error("generic array refinement"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /\.to_vec\(|\.collect\(|JsArray<[^>]*\bBigInt\b/u);
  validateGeneratedProject("generic-array-refinement", result.artifacts, { run: true });
});

test("cross-file generic array union aliases reject conflicting native element widths", () => {
  const { source, result } = compileRust({ surfaces: ["js"], files: conflictingArrayRefinementFiles });
  assertNoTargetDiagnostics(source.diagnostics);
  assert.ok(result.diagnostics.length > 0);
  assert.equal(result.artifacts.length, 0);
});
