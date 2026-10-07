import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { closedRuntimeCategoriesSource } from "../../../../tsonic/test/fixtures/closed-runtime-categories.mjs";

for (const surface of ["native", "js"]) {
  test(`closed runtime category comparisons retain repeated arms and one evaluation (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": closedRuntimeCategoriesSource + '\nexport function main(): void { if (!run()) throw new Error("closed runtime categories"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = result.artifacts.map(artifact => artifact.text).join("\n");
    assert.doesNotMatch(source, /std::any::|type_name\(/);
    validateGeneratedProject(`closed-runtime-categories-${surface}`, result.artifacts, { run: true });
  });
}
