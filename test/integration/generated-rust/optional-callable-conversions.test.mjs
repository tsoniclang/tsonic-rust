import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { optionalCallableConversionSource } from "../../../../tsonic/test/fixtures/optional-callable-conversions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`stored optional, default and discarded callable conversions preserve evaluation in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": optionalCallableConversionSource + '\nexport function main(): void { if (!run()) throw new Error("optional callable conversion"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`optional-callable-conversions-${lane}`, result.artifacts, { run: true });
  });
}
