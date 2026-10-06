import assert from "node:assert/strict";
import test from "node:test";
import { scopedStringComparisonsSource } from "../../../../tsonic/test/fixtures/scoped-string-comparisons.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const profile of ["native", "js"]) {
  test(`scoped string comparisons preserve native snapshots and literals in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: profile === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": scopedStringComparisonsSource } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`scoped-string-comparisons-${profile}`, result.artifacts, { run: true });
  });
}
