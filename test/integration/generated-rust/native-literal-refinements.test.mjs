import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeLiteralRefinementsSource } from "../../../../tsonic/test/fixtures/native-literal-refinements.mjs";

for (const surface of ["native", "js"]) {
  test(`literal union refinements preserve field absence and native carriers (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": nativeLiteralRefinementsSource + '\nexport function main(): void { if (!run()) throw new Error("native literal refinements"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`native-literal-refinements-${surface}`, result.artifacts, { run: true });
  });
}
