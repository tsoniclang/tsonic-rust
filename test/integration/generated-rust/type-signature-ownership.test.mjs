import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { conflictingNativeInterfaceFiles, typeSignatureOwnershipFiles } from "../../../../tsonic/test/fixtures/type-signature-ownership.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`cross-file constructor and structural method signatures retain their owners on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...typeSignatureOwnershipFiles,
      "index.ts": typeSignatureOwnershipFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("type signature ownership"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("type-signature-ownership", result.artifacts, { run: true });
  });
  test(`generic method-only interface contracts retain conflicting native widths on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: conflictingNativeInterfaceFiles });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  });
}
