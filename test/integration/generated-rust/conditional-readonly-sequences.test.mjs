import assert from "node:assert/strict";
import test from "node:test";
import { conditionalReadonlySequencesSource } from "../../../../tsonic/test/fixtures/conditional-readonly-sequences.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`conditional readonly sequences retain exact narrowing and lazy fallback on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": conditionalReadonlySequencesSource +
        '\nexport function main(): void { if (!run()) throw new Error("readonly sequence narrowing"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    if (surfaces.length === 0) {
      const output = artifactText(result, "src/index.rs");
      for (const name of ["emptyLast", "selectedAlias"]) {
        assert.match(output, new RegExp(`fn ${name}\\(present: bool, values: Vec<String>\\) -> Vec<String>`, "u"));
      }
      assert.doesNotMatch(output, /values\.(?:clone|to_vec)\(/u);
    }
    validateGeneratedProject("conditional-readonly-sequences", result.artifacts, { run: true });
  });
}
