import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { voidCompletionSource } from "../../../../tsonic/test/fixtures/void-completions.mjs";

for (const surface of ["native", "js"]) {
  test(`void completions preserve effects and native absence on ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": voidCompletionSource + '\nexport function main(): void { if (!run()) throw new Error("void completion"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`void-completions-${surface}`, result.artifacts, { run: true });
  });
}
