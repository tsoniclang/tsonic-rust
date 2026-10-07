import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { optionalSelectedIndexSource } from "../../../../tsonic/test/fixtures/optional-selected-indexes.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("exact ordinal and broad capture indexes preserve optional native results", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": optionalSelectedIndexSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("optional-selected-indexes", result.artifacts, { run: true });
});
