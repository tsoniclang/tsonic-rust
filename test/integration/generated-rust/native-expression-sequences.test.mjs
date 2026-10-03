import assert from "node:assert/strict";
import test from "node:test";
import { nativeExpressionSequencesSource } from "../../../../tsonic/test/fixtures/native-expression-sequences.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`value sequences preserve exact completion and native effects on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin" } },
        files: { "index.ts": nativeExpressionSequencesSource },
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
      const source = artifactText(result, "src/index.rs");
      assert.match(source, /value: u64/u);
      assert.doesNotMatch(source, /9007199254740993\.0|dyn Any|Box::pin/u);
      validateGeneratedProject("native-expression-sequences", result.artifacts, { run: true });
    });
}
