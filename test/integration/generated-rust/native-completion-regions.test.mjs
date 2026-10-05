import assert from "node:assert/strict";
import test from "node:test";
import { nativeCompletionRegionsSource, nativeFinallyOverrideSource } from "../../../../tsonic/test/fixtures/native-completion-regions.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`native completion regions retain definite initialization and every lexical boundary in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${nativeCompletionRegionsSource}\n${nativeFinallyOverrideSource}\nexport function main(): void { if (!run() || !finallyOverride()) throw new Error("native completion"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    const generated = rustSourceText(result);
    assert.doesNotMatch(generated, /completion_region|MaybeUninit|assume_init|transmute|downcast_unchecked/u);
    validateGeneratedProject(`native-completion-regions-${lane}`, result.artifacts, { run: true });
  });
}
