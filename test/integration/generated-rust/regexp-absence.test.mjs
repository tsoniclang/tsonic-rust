import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { regexpAbsenceSource } from "../../../../tsonic/test/fixtures/regexp-absence.mjs";

test("RegExp capture, index and split results preserve one native absence", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": regexpAbsenceSource + '\nexport function main(): void { if (!run()) throw new Error("RegExp absence"); }' } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("regexp-absence", result.artifacts, { run: true });
});
