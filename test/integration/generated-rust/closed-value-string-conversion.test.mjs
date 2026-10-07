import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { closedValueStringConversionSource } from "../../../../tsonic/test/fixtures/closed-value-string-conversion.mjs";

test("explicit String conversion observes exact closed native payloads", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": closedValueStringConversionSource + '\nexport function main(): void { if (!run()) throw new Error("closed String conversion"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const generated = artifactText(result, "src/index.rs");
  assert.match(generated, /closed_value_string/u);
  assert.doesNotMatch(generated, /\.inspect\(|Debug::fmt/u);
  validateGeneratedProject("closed-value-string-conversion", result.artifacts, { run: true });
});
