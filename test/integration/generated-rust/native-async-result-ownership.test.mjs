import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeAsyncResultOwnershipFiles } from "../../../../tsonic/test/fixtures/native-async-result-ownership.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native async result carriers survive imported re-exports on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { ...nativeAsyncResultOwnershipFiles, "index.ts": nativeAsyncResultOwnershipFiles["index.ts"] +
        '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("native async result ownership"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(output, /\bi64\b/u);
    assert.match(output, /\bu64\b/u);
    assert.doesNotMatch(output, /\bBigInt\b|dyn Future|Box::pin/u);
    if (surfaces.length === 0) assert.doesNotMatch(output, /JsPromise/u);
    validateGeneratedProject("native-async-result-ownership", result.artifacts, { run: true });
  });
}
