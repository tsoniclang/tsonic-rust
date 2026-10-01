import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourceProfileCategoriesSource } from "../../../../tsonic/test/fixtures/source-profile-categories.mjs";

test("source-profile producers retain exact native object, callable and symbol categories", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": sourceProfileCategoriesSource + '\nexport function main(): void { if (!run()) throw new Error("source profile categories"); }',
  } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /#\[derive\(Clone, Debug, PartialEq\)\]\s+pub\(crate\) struct Entry\s*\{\s+pub\(crate\) state:/u);
  validateGeneratedProject("source-profile-categories", result.artifacts, { run: true });
});
