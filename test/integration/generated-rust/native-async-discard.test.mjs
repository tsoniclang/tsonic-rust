import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeAsyncDiscardSource } from "../../../../tsonic/test/fixtures/native-async-discard.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const native = surfaces.length === 0;
  test(`discarded async values retain native scheduling on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": nativeAsyncDiscardSource(1) + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("native async discard"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = artifactText(result, "src/index.rs");
    if (native) {
      assert.match(output, /core::mem::drop\(produce\(argument\(\)\)\)/u);
      assert.match(output, /let _ = &retained/u);
    } else {
      assert.doesNotMatch(output, /core::mem::drop\(produce/u);
      assert.match(output, /retained\.into_value\(\)\.await/u);
    }
    if (native) assert.match(output, /retained\.await/u);
    assert.doesNotMatch(output, /retained\.clone\(\)/u);
    assert.doesNotMatch(output, /Box::pin|\.clone\(\).*await|spawn\(/u);
    validateGeneratedProject("native-async-discard", result.artifacts, { run: true });
  });
}
