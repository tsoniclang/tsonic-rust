import assert from "node:assert/strict";
import test from "node:test";
import { receiverFieldStorageCases, receiverFieldStorageFreezeSource } from "../../fixtures/receiver-field-storage-cases.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) for (const example of receiverFieldStorageCases) {
  test(`live stored fields preserve direct structural views and reentrancy: ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source + '\nexport function main(): void { if (!run()) throw new Error("retained structural field"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test([...result.artifacts.values()].join("\n")), false);
    validateGeneratedProject(`receiver-field-storage-${example.name}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("freezing an identity-preserving direct view rejects live field replacement", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": receiverFieldStorageFreezeSource + '\nexport function main(): void { if (!run()) throw new Error("retained structural freeze"); }' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
  validateGeneratedProject("receiver-field-storage-freeze", result.artifacts, { run: true });
});
