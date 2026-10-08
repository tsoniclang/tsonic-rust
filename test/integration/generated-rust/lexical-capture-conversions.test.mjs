import assert from "node:assert/strict";
import test from "node:test";
import { lexicalCaptureConversionSource } from "../../../../tsonic/test/fixtures/lexical-capture-conversions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`lexical captures retain native storage before contextual conversions in ${profile}`,
    { timeout: 300_000 }, () => {
      const name = `lexical_capture_conversions_${profile}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": lexicalCaptureConversionSource },
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      const source = artifactText(result, "src/index.rs");
      assert.match(source, /fn read\([^)]*: i32\)/u);
      assert.match(source, /fn fail\([^)]*: &Failure\)/u);
      const executed = validateGeneratedProject(name, result.artifacts, { run: true });
      assert.equal(executed.status, 0, executed.stderr);
    });
}
