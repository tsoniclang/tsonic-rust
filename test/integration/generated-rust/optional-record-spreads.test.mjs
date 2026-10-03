import assert from "node:assert/strict";
import test from "node:test";
import { optionalRecordSpreadsSource } from "../../../../tsonic/test/fixtures/optional-record-spreads.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`optional record spreads preserve native presence and order on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `optional_record_spreads_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${optionalRecordSpreadsSource}
        export function main(): void { if (!run()) throw new Error("optional record spread"); }` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    const source = artifactText(result, "src/index.rs");
    assert.equal((source.match(/= selected\(/gu) ?? []).length, 1, "spread input must be evaluated once");
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
