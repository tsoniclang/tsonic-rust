import assert from "node:assert/strict";
import test from "node:test";
import { suspendedProjectContractsSource } from "../../../../tsonic/test/fixtures/suspended-project-contracts.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("suspended project contracts retain native input ownership, completion and exact Error effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": suspendedProjectContractsSource +
      '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("suspended contract"); }' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  validateGeneratedProject("suspended-project-contracts", result.artifacts, { run: true });
});
