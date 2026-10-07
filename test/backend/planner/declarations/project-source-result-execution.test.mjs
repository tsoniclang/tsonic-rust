import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { projectSourceResultContracts } from "../../../fixtures/project-source-result-contracts.mjs";

for (const fixture of projectSourceResultContracts) {
  test(`${fixture.name} executes exact selected result and method contracts`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces: fixture.surfaces,
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: fixture.crateName } },
      files: { "index.ts": fixture.source },
    });
    assertNoTargetDiagnostics(result.diagnostics);
    const execution = validateGeneratedProject(fixture.name, result.artifacts, { run: true });
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  });
}
