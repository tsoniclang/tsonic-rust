import assert from "node:assert/strict";
import test from "node:test";
import { typedBroadRecordFlowSource } from "../../../../tsonic/test/fixtures/broad-record-flow.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("typed broad record array views preserve the original backing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": typedBroadRecordFlowSource + '\nexport function main(): void { if (!run()) throw new Error("typed broad record flow"); }' } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("typed-broad-record-flow", result.artifacts, { run: true });
});
