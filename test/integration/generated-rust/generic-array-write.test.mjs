import assert from "node:assert/strict";
import test from "node:test";
import { genericArrayWriteSource } from "../../../../tsonic/test/fixtures/generic-array-write.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surface of [undefined, "js"]) {
  test(`generic array stores impose no read-only Clone bound on ${surface ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === undefined ? [] : [surface],
      target: { id: "rust", options: { outputType: "bin", crateName: "generic_array_write" } },
      files: { "index.ts": `${genericArrayWriteSource}
        export function main(): void { if (!run()) throw new Error("generic array write"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    const declaration = source.match(/pub fn assign<[\s\S]*?\{/u)?.[0];
    assert.equal(declaration !== undefined, true, "generic native assign declaration");
    assert.doesNotMatch(declaration, /\bClone\b/u, "a write does not read or clone the element");
    validateGeneratedProject(`generic-array-write-${surface ?? "native"}`, result.artifacts, { run: true });
  });
}
