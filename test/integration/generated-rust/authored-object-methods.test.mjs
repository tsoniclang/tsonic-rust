import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { authoredObjectMethodEvidenceSource } from "../../../../tsonic/test/fixtures/generic-object-methods.mjs";

for (const surface of ["native", "js"]) {
  test(`authored ordinary methods retain their exact body and shared captures (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": authoredObjectMethodEvidenceSource + '\nexport function main(): void { if (!run()) throw new Error("authored method evidence"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`authored-object-methods-${surface}`, result.artifacts, { run: true });
  });
}
