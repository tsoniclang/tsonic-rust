import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { optionalPrimitiveConversionsSource } from "../../../../tsonic/test/fixtures/optional-primitive-conversions.mjs";

test("optional primitive conversion retains native values, absence and API-local behavior", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": optionalPrimitiveConversionsSource + '\nexport function main(): void { if (!run()) throw new Error("optional conversion"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const generated = artifactText(result, "src/index.rs");
  const integer = generated.split("fn integer(")[1]?.split(/\n(?:pub(?:\([^)]*\))? )?fn /u)[0];
  assert.ok(integer !== undefined);
  assert.doesNotMatch(integer, /JsValue|BigInt|as f64|\.clone\(/u);
  validateGeneratedProject("optional-primitive-conversions", result.artifacts, { run: true });
});
