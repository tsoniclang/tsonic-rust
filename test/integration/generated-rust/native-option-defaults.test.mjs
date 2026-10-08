import test from "node:test";
import { nativeOptionDefaultsSource } from "../../../../tsonic/test/fixtures/native-option-defaults.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native defaults retain literals, signed zero and lazy suspended destructuring", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": nativeOptionDefaultsSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("native-option-defaults", result.artifacts, { run: true });
});
