import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { partialRecordAbsenceSource } from "../../../../tsonic/test/fixtures/partial-record-absence.mjs";
import { sourceProfileAliasIdentityFiles, sourceProfileAliasIdentitySource } from "../../../../tsonic/test/fixtures/source-profile-alias-identity.mjs";

test("partial records preserve absence, present zero, and copied result slots", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": partialRecordAbsenceSource + '\nexport function main(): void { if (!run()) throw new Error("partial record"); }' } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("partial-record-absence", result.artifacts, { run: true });
});

test("cross-file generic profile aliases preserve exact carriers without recognizing local homonyms", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { ...sourceProfileAliasIdentityFiles,
      "index.ts": sourceProfileAliasIdentitySource + '\nexport function main(): void { if (!run()) throw new Error("profile alias identity"); }' } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("source-profile-alias-identity", result.artifacts, { run: true });
});
