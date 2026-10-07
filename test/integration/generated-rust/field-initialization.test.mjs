import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { fieldInitializationSource } from "../../../../tsonic/test/fixtures/field-initialization.mjs";

for (const surface of ["native", "js"]) {
  test(`explicit native fields have no runtime marker initializer on ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": fieldInitializationSource + '\nexport function main(): void { if (!run()) throw new Error("field initialization"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`field-initialization-${surface}`, result.artifacts, { run: true });
  });
}
