import assert from "node:assert/strict";
import test from "node:test";
import { polymorphicThisResultsSource } from "../../../../tsonic/test/fixtures/polymorphic-this-results.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`checked polymorphic this returns preserve the actual result and derived members in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${polymorphicThisResultsSource}\nexport function main(): void { if (!run()) throw new Error("polymorphic-this-results"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    const emitted = artifactText(result, "src/index.rs");
    assert.match(emitted, /Child::try_from\(/u);
    assert.doesNotMatch(emitted, /invoke_dynamic|read_dynamic_slot|downcast_unchecked|transmute/u);
    validateGeneratedProject(`polymorphic-this-results-${lane}`, result.artifacts, { run: true });
  });
}
