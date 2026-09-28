import assert from "node:assert/strict";
import { test } from "node:test";
import { createRustSession, rustSourceDiagnostics, compileRust } from "../helpers/rust-session.mjs";
import { sourceCallabilityPositiveCases, sourceCallabilityNegativeCases, sourceCallabilityEmissionSource }
  from "../../../tsonic/test/fixtures/source-callability.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  for (const entry of sourceCallabilityPositiveCases) {
    test(`${profile}: ${entry.name}`, () => {
      assert.equal(rustSourceDiagnostics(createRustSession({ surfaces, files: { "index.ts": entry.source } })), "");
    });
  }
  for (const entry of sourceCallabilityNegativeCases) {
    test(`${profile}: ${entry.name}`, () => {
      assert.match(rustSourceDiagnostics(createRustSession({ surfaces, files: { "index.ts": entry.source } })), entry.diagnostic);
    });
  }
  test(`${profile}: ambient callable identity has no emitted representation`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": sourceCallabilityEmissionSource } });
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.artifacts.length > 0);
    const output = result.artifacts.map(artifact => artifact.text).join("\n");
    assert.doesNotMatch(output, /\b(?:callable|CallableFunction|NewableFunction)\b|Rc::|Arc::|RefCell::|Box::/u);
  });
}
