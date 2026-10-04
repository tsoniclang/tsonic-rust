import assert from "node:assert/strict";
import test from "node:test";
import { optionalProjectCarriersSource } from "../../../../tsonic/test/fixtures/optional-project-carriers.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`optional project positions preserve live derived identity in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${optionalProjectCarriersSource}\nexport function main(): void { if (!run()) throw new Error("optional-project-carriers"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    const emitted = artifactText(result, "src/index.rs");
    assert.doesNotMatch(emitted, /invoke_dynamic|read_dynamic_slot|downcast_unchecked|transmute|Box::new/u);
    validateGeneratedProject(`optional-project-carriers-${lane}`, result.artifacts, { run: true });
  });
}
