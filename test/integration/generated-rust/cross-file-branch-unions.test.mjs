import assert from "node:assert/strict";
import test from "node:test";
import { crossFileBranchUnionFiles } from "../../../../tsonic/test/fixtures/cross-file-branch-unions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`cross-file branch unions preserve exact aliases, native payloads and absence on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { ...crossFileBranchUnionFiles, "index.ts": crossFileBranchUnionFiles["index.ts"] +
        '\nexport function main(): void { if (!run()) throw new Error("cross-file branch union"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject("cross-file-branch-unions", result.artifacts, { run: true });
  });
}
