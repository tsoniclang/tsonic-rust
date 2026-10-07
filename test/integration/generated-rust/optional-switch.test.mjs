import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { optionalSwitchSource } from "../../../../tsonic/test/fixtures/optional-switch.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`optional switch preserves native equality and ordered effects on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": optionalSwitchSource + '\nexport function main(): void { if (!run()) throw new Error("optional switch"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = artifactText(result, "src/index.rs");
    const start = output.indexOf("fn literal(");
    const end = output.indexOf("fn grouped(");
    assert.ok(start >= 0 && end > start, "Both native function boundaries must be present for the allocation audit");
    const literal = output.slice(start, end);
    assert.doesNotMatch(literal, /String::from|\.to_owned\(|\.clone\(/u);
    validateGeneratedProject("optional-switch", result.artifacts, { run: true });
  });
}
