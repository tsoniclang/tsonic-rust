import assert from "node:assert/strict";
import test from "node:test";
import { closedUnionCallbackCompletionSource, closedUnionValueCallbackCompletionSource } from "../../../../tsonic/test/fixtures/closed-union-callback-completion.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`finite native union callbacks retain checked absence completion on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": closedUnionValueCallbackCompletionSource +
        '\nexport function main(): void { if (!run()) throw new Error("finite union completion"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject("finite-union-callback-completion", result.artifacts, { run: true });
  });
  test(`closed-union callbacks retain checked absence completion on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": closedUnionCallbackCompletionSource +
        '\nexport function main(): void { if (!run()) throw new Error("closed-union completion"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject("closed-union-callback-completion", result.artifacts, { run: true });
  });
}
