import assert from "node:assert/strict";
import test from "node:test";
import { errorContainerStorageFiles } from "../../../../tsonic/test/fixtures/error-container-storage.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`Error container storage preserves exact element identity in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { ...errorContainerStorageFiles,
        "index.ts": `${errorContainerStorageFiles["index.ts"]}\nexport function main(): void { if (!run()) throw new Error("error-container-storage"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    assert.doesNotMatch(artifactText(result, "src/index.rs"), /invoke_dynamic|downcast_unchecked|transmute|Box::new/u);
    validateGeneratedProject(`error-container-storage-${lane}`, result.artifacts, { run: true });
  });
}
