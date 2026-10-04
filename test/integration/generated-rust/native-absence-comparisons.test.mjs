import assert from "node:assert/strict";
import test from "node:test";
import { nativeAbsenceComparisonSource } from "../../../../tsonic/test/fixtures/native-absence-comparisons.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`native absence comparisons retain physical class and record storage in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": nativeAbsenceComparisonSource +
        '\nexport function main(): void { if (!run()) throw new Error("native absence comparisons"); }' },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
      .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
    assert.equal(validateGeneratedProject(`native-absence-comparisons-${profile}`, result.artifacts, { run: true }).status, 0);
  });
}
