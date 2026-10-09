import assert from "node:assert/strict";
import test from "node:test";
import { capturedCallbackAritySource } from "../../../../tsonic/test/fixtures/captured-callback-arity.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`captured native methods retain their sealed arity independently of contextual callbacks (${surfaces.length === 0 ? "native" : "js"})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: "captured_callback_arity" } },
        files: { "index.ts": `${capturedCallbackAritySource}
export function main(): void { if (!run()) throw new Error("captured callback arity"); }` } });
      assertNoTargetDiagnostics(result.diagnostics);
      assert.equal(validateGeneratedProject(`captured-callback-arity-${surfaces.length}`, result.artifacts, { run: true }).status, 0);
    });
}
